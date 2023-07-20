const MongoClient = require('mongodb').MongoClient;
require('dotenv').config();


const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function connectToCluster(uri) {
  let mongoClient;

  try {
    mongoClient = new MongoClient(uri);
    console.log('Connecting to MongoDB Atlas cluster...');
    await mongoClient.connect();
    console.log('Successfully connected to MongoDB Atlas!');

    return mongoClient;
  } catch (error) {
    console.error('Connection to MongoDB Atlas failed!', error);
    process.exit();
  }
}

async function createIntakeFormDocument(collection, formData) {
  const intakeFormDocument = {
    ...formData,
    dob: new Date(formData.dob),
  };

  try {
    const result = await collection.insertOne(intakeFormDocument);
    return result;
  } catch (error) {
    throw new Error('Failed to insert document');
  }
}

async function executeIntakeFormCrudOperations(formData) {
  const uri = process.env.DB_URI;
  let mongoClient;

  try {
    mongoClient = await connectToCluster(uri);
    const db = mongoClient.db('Cluster0');  // replace 'Cluster0' with your database name
    const collection = db.collection('intakeforms'); // replace 'intakeforms' with your collection name

    console.log('CREATE IntakeForm');
    const result = await createIntakeFormDocument(collection, formData);
    return result;
  } finally {
    await mongoClient.close();
  }
}

// POST endpoint
app.post('/', async (req, res) => {
  // process the data
  try {
    const result = await executeIntakeFormCrudOperations(req.body);
    res.status(200).json({ message: 'Form successfully submitted', result });
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});

// Catch 404
app.use((req, res, next) => {
  res.status(404).json({ message: "Not found" });
});

// Specify the PORT
const PORT = process.env.PORT || 3000;

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Server started successfully!');
});

