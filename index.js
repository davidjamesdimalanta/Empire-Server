const express = require('express');
const cors = require('cors');
const MongoClient = require('mongodb').MongoClient;
require('dotenv').config();
const https = require('https');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { S3 } = require('@aws-sdk/client-s3');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const CLIENT_ID = process.env.CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);
const app = express();

// CORS
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Connect to DO Bucket
const s3 = new S3({
  region: 'nyc3',
  endpoint: 'https://nyc3.digitaloceanspaces.com',
  credentials: {
    accessKeyId: process.env.DO_SPACES_ACCESS_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET_KEY,
  },
});

// Upload and Read img URL
async function uploadImageToSpaces(file) {
  console.log(file.path)
  const fileContent = await fs.promises.readFile(file.path);

  const params = {
    Bucket: 'intakeformimages',
    Key: file.filename, // File name to save as in S3
    Body: fileContent,
    ACL: 'public-read', // Makes sure file is public
  };

  try {
    await s3.putObject(params); 
    console.log('File uploaded successfully');

    // Construct the file URL
    const fileUrl = `https://${params.Bucket}.nyc3.digitaloceanspaces.com/${params.Key}`;

    await fs.promises.unlink(file.path); // Deletes the local file

    return fileUrl; // Returns the URL of the uploaded file
  } catch (error) {
    console.log('Error in uploading file: ', error);
    throw error;
  }
}

// POST endpoint
app.post('/', upload.fields([{name:'photoId', maxCount: 1 }, {name:'medsList', maxCount: 1}]), async (req, res) => {
  try {
    console.log(req.files)
    const imageUrlPhotoId = await uploadImageToSpaces(req.files.photoId[0]);
    console.log('imageUrlPhotoId:', imageUrlPhotoId);
    const imageUrlMedsList = await uploadImageToSpaces(req.files.medsList[0]);
    console.log('imageUrlMedsList:', imageUrlMedsList);

    let formData = { ...req.body };
    formData.photoIdUrl = imageUrlPhotoId;
    formData.medsListUrl = imageUrlMedsList;

    const result = await executeIntakeFormCrudOperations(formData);
    res.status(200).json({ message: 'Form successfully submitted', result });
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});

// connect to mongoDB
async function connectToCluster(uri) {
  try {
    const mongoClient = new MongoClient(uri);
    console.log('Connecting to MongoDB Atlas cluster...');
    await mongoClient.connect();
    console.log('Successfully connected to MongoDB Atlas!');
    return mongoClient;
  } catch (error) {
    console.error('Connection to MongoDB Atlas failed!', error);
    throw error;
  }
}

// Mongo POST
async function createIntakeFormDocument(collection, formData) {
  const intakeFormDocument = {
    ...formData,
    dob: new Date(formData.dob),
  };

  try {
    const result = await collection.insertOne(intakeFormDocument);
    console.log(result)
    return result;
  } catch (error) {
    throw new Error(`Failed to insert document: ${error.message}`);
  }
}

async function executeIntakeFormCrudOperations(formData) {
  const uri = process.env.DB_URI;
  const mongoClient = await connectToCluster(uri);

  try {
    const db = mongoClient.db('Cluster0');
    const collection = db.collection('intakeforms');

    console.log('CREATE IntakeForm');
    const result = await createIntakeFormDocument(collection, formData);
    return result;
  } finally {
    await mongoClient.close();
  }
}

// Mongo GET
async function fetchIntakeFormDocuments() {
  const uri = process.env.DB_URI;
  const mongoClient = await connectToCluster(uri);

  try {
    const db = mongoClient.db('Cluster0');
    const collection = db.collection('intakeforms');

    console.log('FETCH IntakeForms');
    const documents = await collection.find({}).toArray();
    return documents;
  } finally {
    await mongoClient.close();
  }
}

// GET endpoint
app.get('/data', async (req, res) => {
  try {
    const documents = await fetchIntakeFormDocuments();
    res.status(200).json(documents);
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});

// Catch 404
app.use((req, res, next) => {
  res.status(404).json({ message: "Not found" });
});

// Specify the PORT
const PORT = process.env.PORT || 443;

// SSL options
const options = {
  key: fs.readFileSync(process.env.SSL_KEY_PATH),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH)
};

// LOCAL Start Server
try {
  https.createServer(options, app).listen(PORT, () => {
    console.log(`Server running on https://localhost:${PORT}`);
    console.log('Server started successfully!');
  });
} catch (error) {
  console.error('Failed to create HTTPS server!', error);
  process.exit(1);
}

// Google Authentication
app.post('/api/v1/auth/google', async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const userid = payload['sub'];

    const userEmail = payload['email'];
    const userDomain = userEmail.split('@')[1];

    const allowedDomains = ['q-globalmgmt.com', 'empirehsi.com'];

    if (!allowedDomains.includes(userDomain)) {
      return res.status(403).json({ message: 'The domain of your Google account is not allowed.' });
    }

    // UserService is missing or not imported properly**
    let user = await UserService.getUserByGoogleId(userid);

    if (!user) {
      user = await UserService.createUser({ googleId: userid, email: userEmail });
    }

    const jwtToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({ token: jwtToken });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error', error: error.message });
  }
});