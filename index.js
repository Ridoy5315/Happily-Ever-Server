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

const { MongoClient, ServerApiVersion } = require("mongodb");
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

    //jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "2h",
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
    //get biodatas from database
    app.get("/biodatas", async (req, res) => {
      const result = await biodatasCollection.find().toArray();
      res.send(result);
    });

    // get a single biodata details by biodata id from database
    app.get("/biodata-details/:bioDataId", verifyToken, async (req, res) => {
      const id = req.params.bioDataId;
      const query = { bioDataId: id };
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

    //check user is premium or not
    app.get("/user/premium/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role });
    });

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
