const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
require('dotenv').config()
const jwt = require('jsonwebtoken')
const port = process.env.PORT || 5000
const app = express()
const cookieParser = require('cookie-parser')
const corsOptions = {
  origin: ['http://localhost:5173'],
  credentials: true,
  optionalSuccessStatus: 200,
}

app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8kdu5.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

// verifyToken
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token
  if (!token) return res.status(401).send({ message: 'unauthorized access' })
  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
  })

  next()
}
 
async function run() {
  try {
    const db = client.db('skillDB')
    const jobsCollection = db.collection('jobs');
    const bidsCollection = db.collection('bids');

    // generate jwt token
    app.post('/jwt', async(req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.SECRET_KEY, { expiresIn: '100d' })
      res
      .cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      })
      .send({ success: true })
    })

    // logout || clear cookie from browser
    app.get('/logout', async (req, res) => {
      res
        .clearCookie('token', {
          maxAge: 0,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })

    // save a jobData in db
    app.post('/add-job', async (req, res) => {
      const jobData = req.body
      const result = await jobsCollection.insertOne(jobData)
      console.log(result)
      res.send(result)
    })

    // get all jobs from db
    app.get('/jobs', async(req, res) => {
      const result = await jobsCollection.find().toArray()
      res.send(result);
    })

    // get all jobs posted by a specific user
    app.get('/jobs/:email', verifyToken, async(req, res) => {
      const email = req.params.email;
      const decodedEmail = req.user?.email;
      
      if (decodedEmail !== email) {
        return res.status(401).send({ message: 'unauthorized access' })
      }
      const query = { 'buyer.email': email }
      const result = await jobsCollection.find(query).toArray();
      res.send(result);
    })

    // delete a job from db
    app.delete('/job/:id',verifyToken, async(req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await jobsCollection.deleteOne(query);
      res.send(result);
    })

    // get a single job data by id from db
    app.get('/job/:id', async(req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await jobsCollection.findOne(query);
      res.send(result);
    })

     // update a job in db
     app.put('/update-job/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const jobData = req.body
      const options = { upsert: true }
      const updatedDoc = {
        $set: jobData,
      }
      const result = await jobsCollection.updateOne(filter, updatedDoc, options)
      res.send(result)
    })

    // save a bid Data in db and update bid count in jobs collection
    app.post('/add-bid', async (req, res) => {
      const bidData = req.body
      // 0. check if the job is already bid by the same user
      const query = { email: bidData.email, jobId: bidData.jobId }
      const alreadyExist = await bidsCollection.findOne(query)
      if(alreadyExist){
        return res
        .status(400)
        .send('You have already bid on this job')
      }


      // 1. save data in bids collection
      const result = await bidsCollection.insertOne(bidData)

      // 2. Increase bid count in jobs collection
      const filter = { _id: new ObjectId(bidData.jobId) }
      const update = { $inc: { bid_count: 1 } }
      const updateBidCount = await jobsCollection.updateOne(filter, update)


      res.send(result)
    })

    // get all bids for a specific user and get bid requests for a specific user
    // using single api for two pages my bids and bid requests
    app.get('/bids/:email', verifyToken, async(req, res) => {
      const isBuyer = req.query.buyer;
      const email = req.params.email;
      const decodedEmail = req.user?.email;
      

      if (decodedEmail !== email) {
        return res.status(401).send({ message: 'unauthorized access' })
      }
        

      let query = {};
      if(isBuyer){
        query.buyer = email;
      } else{
        query.email = email;
      }
      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    })

     // update bid status
     app.patch('/bid-status-update/:id', async (req, res) => {
      const id = req.params.id
      const { status } = req.body

      const filter = { _id: new ObjectId(id) }
      const updated = {
        $set: { status },
      }
      const result = await bidsCollection.updateOne(filter, updated)
      res.send(result)
    })

    //get all job (search, filter, sort)
    app.get('/all-jobs', async(req, res) => {
      const filter = req.query.filter;
      const search = req.query.search;
      const sort = req.query.sort;
      let options = {};
      if(sort){
        options = { sort: {deadline: sort === 'asc' ? 1 : -1} }
      }
      let query = {
        title: { $regex: search, $options: 'i' }
      };
      if(filter){
        query.category = filter;
      }
      const result = await jobsCollection.find(query, options).toArray();
      res.send(result);
    })

    

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)
app.get('/', (req, res) => {
  res.send('Hello from SkillSphere Server....')
})

app.listen(port, () => console.log(`Server running on port ${port}`))
