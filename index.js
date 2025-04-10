require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 3000;
const morgan = require("morgan");

const formData = require("form-data");
const Mailgun = require("mailgun.js");
const mailgun = new Mailgun(formData);

const mg = mailgun.client({
  username: "api",
  key: process.env.MAIL_GUN_API_KEY,
});

//middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

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
    // await client.connect();

    const biodatasCollection = client
      .db("Matrimony")
      .collection("user_biodatas");
    const usersCollection = client.db("Matrimony").collection("users");
    const contactRequestCollection = client
      .db("Matrimony")
      .collection("contact_request");
    const favoritesBiodataCollection = client
      .db("Matrimony")
      .collection("favorites_Biodata");
    const successStoryCollection = client
      .db("Matrimony")
      .collection("success_story");
    const bannerCollection = client.db("Matrimony").collection("banner");

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

    //get photo for banner
    app.get("/banner", async (req, res) => {
      const result = await bannerCollection.find().toArray();
      res.send(result);
    });

    //biodata related api
    //save user biodata in db
    app.post("/bioData", verifyToken, async (req, res) => {
      const bioData = req.body;

      //check email if user doesn't create biodata
      const query = { contactEmail: bioData.contactEmail };
      const existingUser = await biodatasCollection.findOne(query);
      if (existingUser) {
        return res.send({ insertedId: null });
      }

      const lastBioDataId = await biodatasCollection
        .find()
        .sort({ bioDataId: -1 })
        .limit(1)
        .toArray();
      const lastId = lastBioDataId.length > 0 ? lastBioDataId[0].bioDataId : 0;
      const newBioData = {
        bioDataId: lastId + 1,
        ...bioData,
      };

      const result = await biodatasCollection.insertOne(newBioData);
      res.send(result);
    });
    //get biodatas from database
    app.get("/biodatas", async (req, res) => {
      const min = parseInt(req.query?.min);
      const max = parseInt(req.query?.max);
      const gender = req.query?.gender;
      const division = req.query?.division;
      const page = parseInt(req.query?.page) || 1;
      const limit = parseInt(req.query.limit) || 6;
      const skip = (page - 1) * limit;

      let query = {};
      if (min && max) {
        query = {
          age: { $gte: min, $lte: max },
        };
      }
      if (gender) {
        query = {
          ...query,
          bioDataType: gender,
        };
      }
      if (division) {
        query = {
          ...query,
          permanentDivisionName: division,
        };
      }
      const allBiodatasResult = await biodatasCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .toArray();
      const totalBiodatas = await biodatasCollection.countDocuments(query);

      const premiumBiodatasResult = await usersCollection
        .aggregate([
          {
            $match: { role: "premium" },
          },
          {
            $lookup: {
              from: "user_biodatas",
              localField: "email",
              foreignField: "contactEmail",
              as: "userData",
            },
          },
          {
            $unwind: { path: "$userData", preserveNullAndEmptyArrays: true },
          },
          {
            $project: {
              role: 1,
              bioDataId: "$userData.bioDataId",
              bioDataType: "$userData.bioDataType",
              profileImage: "$userData.profileImage",
              permanentDivisionName: "$userData.permanentDivisionName",
              occupation: "$userData.occupation",
              email: "$userData.contactEmail",
              age: "$userData.age",
            },
          },
          { $skip: skip },
          { $limit: limit },
        ])
        .toArray();
      res.send({ allBiodatasResult, premiumBiodatasResult, totalBiodatas, totalPages: Math.ceil(totalBiodatas / limit), currentPage: page, });
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
      const { email, gender } = req.query;
      const result = await biodatasCollection
        .find({ bioDataType: gender, contactEmail: { $ne: email } })
        .limit(3)
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

      const result = await usersCollection.insertOne({
        ...user,
        role: "normal_user",
      });
      res.send(result);
    });

    //get all user
    app.get("/allUsers/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const search = req.query?.search;
      let query = {};
      query = { email: { $ne: email } };
      if (search) {
        query.name = { $regex: search, $options: "i" };
      }
      console.log(query);
      const result = await usersCollection.find(query).toArray();
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
    app.get("/user/bioData/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { contactEmail: email };
      const result = await biodatasCollection.findOne(query);
      res.send(result);
    });

    //check user is premium or not
    app.get("/user/premium/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role });
    });

    //make user admin
    app.patch("/user/:email", verifyToken, verifyAdmin, async (req, res) => {
      const userRole = req.body;
      console.log(userRole);
      const email = req.params.email;
      const filter = { email: email };
      if (userRole?.role === "make-admin") {
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await usersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      } else {
        const updatedDoc = {
          $set: {
            role: "premium",
          },
        };
        const result = await usersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    });

    //send request to the admin for make premium
    app.patch("/user/premium/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updatedDoc = {
        $set: {
          role: "requested_for_premium",
        },
      };
      const result = await usersCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    //get the user who requested for premium to the admin
    app.get(
      "/user/request-premium",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        // const query = { role: "requested_for_premium"};
        const result = await usersCollection
          .aggregate([
            {
              $match: { role: "requested_for_premium" },
            },
            {
              $lookup: {
                from: "user_biodatas",
                localField: "email",
                foreignField: "contactEmail",
                as: "id",
              },
            },
            {
              $project: {
                name: 1,
                email: 1,
                "id.bioDataId": 1,
              },
            },
          ])
          .toArray();
        console.log(result);
        res.send(result);
      }
    );

    //count how many user in mongodb for admin dashboard
    app.get("/user/count", verifyToken, verifyAdmin, async (req, res) => {
      const totalUsers = await biodatasCollection.countDocuments();
      const maleUsers = await biodatasCollection.countDocuments({
        bioDataType: "Male",
      });
      const femaleUsers = await biodatasCollection.countDocuments({
        bioDataType: "Female",
      });
      const premiumUsers = await usersCollection.countDocuments({
        role: "premium",
      });
      const totalRevenue = await contactRequestCollection.countDocuments({
        status: "Approved",
      });

      const result = {
        totalUsers,
        maleUsers,
        femaleUsers,
        premiumUsers,
        totalRevenue,
      };

      res.send(result);
    });
    //count how many user in mongodb for homepage
    app.get("/user-count", async (req, res) => {
      const totalUsers = await biodatasCollection.countDocuments();
      const maleUsers = await biodatasCollection.countDocuments({
        bioDataType: "Male",
      });
      const femaleUsers = await biodatasCollection.countDocuments({
        bioDataType: "Female",
      });
      const premiumUsers = await usersCollection.countDocuments({
        role: "premium",
      });

      const result = {
        totalUsers,
        maleUsers,
        femaleUsers,
        premiumUsers,
      };

      res.send(result);
    });

    //contact request
    app.post("/contact-request", verifyToken, async (req, res) => {
      const contactRequestInfo = req.body;
      const result = await contactRequestCollection.insertOne(
        contactRequestInfo
      );

      //send user email about payment confirmation
      mg.messages
        .create(process.env.MAIL_SENDING_DOMAIN, {
          from: "Mailgun Sandbox <postmaster@sandboxd628d01b873b48b3afb4e5324cac041c.mailgun.org>",
          to: ["ridoy.st99@gmail.com"],
          subject: "Matrimony Platform Contact Request Confirmation",
          html: `
          <div>
          <h2>thank you for your requesting contact</h2>
          <h4>Your Transaction Id: <strong>${contactRequestInfo?.transactionId}</strong></h4>
          <p>Admin will accept your contact request soon, if you are valid user</p>
          </div>
          `,
        })
        .then((msg) => console.log(msg))
        .catch((err) => console.log(err));
      res.send(result);
    });
    //get the all contact-request
    app.get("/contact-request", verifyToken, verifyAdmin, async (req, res) => {
      const query = { status: "Pending" };
      const result = await contactRequestCollection.find(query).toArray();
      res.send(result);
    });

    //contact request status change
    app.patch(
      "/contact-request/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            status: "Approved",
          },
        };
        const result = await contactRequestCollection.updateOne(
          filter,
          updatedDoc
        );
        res.send(result);
      }
    );

    //get specific user all contact request
    app.get("/contact-request/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const filter = { userEmail: email };
      const result = await contactRequestCollection.find(filter).toArray();
      res.send(result);
    });
    //delete contact request data
    app.delete("/contact-request/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await contactRequestCollection.deleteOne(query);
      res.send(result);
    });

    //post the users favorites biodata
    app.post("/favorite-biodata", verifyToken, async (req, res) => {
      const favoriteBiodataInfo = req.body;
      const result = await favoritesBiodataCollection.insertOne(
        favoriteBiodataInfo
      );
      res.send(result);
    });
    //get specific user all favorites biodata
    app.get("/favorite-biodata/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const filter = { userEmail: email };
      const result = await favoritesBiodataCollection.find(filter).toArray();
      res.send(result);
    });
    //delete single favorite biodata
    app.delete("/favorite-biodata/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await favoritesBiodataCollection.deleteOne(query);
      res.send(result);
    });

    //post success couple story data and review
    app.post("/user-married", verifyToken, async (req, res) => {
      const data = req.body;
      const result = await successStoryCollection.insertOne(data);
      res.send(result);
    });

    //get success couple story data and review
    app.get("/user-married", async (req, res) => {
      const result = await successStoryCollection
        .find()
        .sort({ marriageDate: 1 })
        .toArray();
      res.send(result);
    });
    //get success couple story data and review
    app.get(
      "/user-married-story",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await successStoryCollection.find().toArray();
        res.send(result);
      }
    );

    //create payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const totalPrice = 5 * 100; //total price in cent
      const { client_secret } = await stripe.paymentIntents.create({
        amount: totalPrice,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({ clientSecret: client_secret });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //   await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Assignment 12 project");
});

app.listen(port, () => {
  console.log(`Bistro boss is sitting on port ${port}`);
});
