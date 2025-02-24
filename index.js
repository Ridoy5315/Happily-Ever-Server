require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 3000;
const morgan = require("morgan");

//middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.oggyj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const biodatasCollection = client
      .db("Matrimony")
      .collection("user_biodatas");
    const usersCollection = client.db("Matrimony").collection("users");
    const contactRequestCollection = client.db("Matrimony").collection("contact_request");
    const favoritesBiodataCollection = client.db("Matrimony").collection("favorites_Biodata");

    //jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1d",
      });
      res.send({ token });
    });

    //middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    //use verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //check the user is admin or not
    app.get("/user/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    //biodata related api
    //save user biodata in db
    app.post("/bioData", verifyToken, async(req, res) => {
      const bioData = req.body;

      //check email if user doesn't create biodata
      const query = { contactEmail: bioData.contactEmail };
      const existingUser = await biodatasCollection.findOne(query);
      if (existingUser) {
        return res.send({ insertedId: null });
      }

      const lastBioDataId = await biodatasCollection.find().sort({bioDataId: -1}).limit(1).toArray();
      const lastId = lastBioDataId.length > 0 ? lastBioDataId[0].bioDataId : 0;
      const newBioData = {
        bioDataId : lastId + 1,
        ...bioData,
      }

      const result = await biodatasCollection.insertOne(newBioData);
      res.send(result);
    })
    //get biodatas from database
    app.get("/biodatas", async (req, res) => {
      const result = await biodatasCollection.find().toArray();
      res.send(result);
    });

    // get a single biodata details by biodata id from database
    app.get("/biodata-details/:bioDataId", verifyToken, async (req, res) => {
      const id = req.params.bioDataId;
      const query = { bioDataId: parseInt(id) };
      const result = await biodatasCollection.findOne(query);
      res.send(result);
    });

    //get similar biodata for details page
    app.get("/bioData-similar", verifyToken, async (req, res) => {
      // const gender = req.params.gender;
      const {email, gender} = req.query;
      const result = await biodatasCollection
        .find({ bioDataType: gender, contactEmail: { $ne: email } }).limit(3)
        .toArray();
      res.send(result);
    });

    //user related api
    //post the sign up user data
    app.post("/user", async (req, res) => {
      const user = req.body;
      //check email if user doesn't exists
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ insertedId: null });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //change the user info
    app.patch("/userInfo/:email", verifyToken, async (req, res) => {
      const userData = req.body;
      const email = req.params.email;
      const filter = { email: email };
      const updatedDoc = {
        $set: {
          name: userData.name,
          image: userData.profileImage,
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    //get user biodata details
    app.get('/user/bioData/:email', verifyToken, async(req, res) => {
      const email = req.params.email;
      const query = {contactEmail: email};
      const result = await biodatasCollection.findOne(query);
      res.send(result);
    })

    //check user is premium or not
    app.get("/user/premium/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role });
    });


    //contact request
    app.post('/contact-request', verifyToken, async(req, res) => {
      const contactRequestInfo = req.body;
      const result = await contactRequestCollection.insertOne(contactRequestInfo);
      res.send(result);
    })
    //get specific user all contact request
    app.get('/contact-request/:email', verifyToken, async(req, res) => {
      const email = req.params.email;
      const filter = { userEmail : email }
      const result = await contactRequestCollection.find(filter).toArray();
      res.send(result);
    })
    //delete contact request data 
    app.delete('/contact-request/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await contactRequestCollection.deleteOne(query);
      res.send(result);
    })

    //post the users favorites biodata
    app.post('/favorite-biodata', verifyToken, async(req, res) => {
      const favoriteBiodataInfo = req.body;
      const result = await favoritesBiodataCollection.insertOne(favoriteBiodataInfo);
      res.send(result);
    })
    //get specific user all favorites biodata
    app.get('/favorite-biodata/:email', verifyToken, async(req, res) => {
      const email = req.params.email;
      const filter = { userEmail : email }
      const result = await favoritesBiodataCollection.find(filter).toArray();
      res.send(result);
    })
    //delete single favorite biodata
    app.delete('/favorite-biodata/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await favoritesBiodataCollection.deleteOne(query);
      res.send(result);
    })

    //create payment intent
    app.post('/create-payment-intent', verifyToken, async(req, res) => {
      const totalPrice = 5 * 100; //total price in cent
      const {client_secret} = await stripe.paymentIntents.create({
        amount: totalPrice,
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({clientSecret: client_secret})
    })



    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //     await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Assignment 12 project");
});

app.listen(port, () => {
  console.log(`Bistro boss is sitting on port ${port}`);
});
