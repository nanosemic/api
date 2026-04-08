const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const crypto = require("crypto");
const axios = require('axios');
require('dotenv').config();
// require('./Server/worker');  
const https = require('https');
const { Readable } = require('stream');

const fs = require('fs');
const path = require('path');  

const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });
const {Users,Terralyt} = require('./Server/Schema');

const app = express();
const PORT = 8082;
const SECRET_KEY = '1234';
const Hardware_SECRET_KEY='456';
app.use(cors({exposedHeaders: ["Content-Disposition"]}));
app.use(express.json());


const GITHUB_TOKEN = process.env.GITHUB_BEARER_TOKEN;




const salt=8;
console.clear()     
mongoose.connect(process.env.MONGODB)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));



app.get('/', async (req, res) => {
  res.json({ message: "Hello" });
});


// -------------------------- variable  ---------------------------

let blacklistedTokens = [];

//dont need this   for future work
const allowedFields = [
  'deviceName',
  'firmwareVersion',
  'macAddress',
  'charts',
  'sensors'
];

const userConnections = new Map();





// --------------------------Functions---------------------------

const getDateTime = () => {
  const date = new Date();
  const istOffset = 5.5 * 60; // in minutes
  const istTime = new Date(date.getTime() + istOffset * 60 * 1000);
  return istTime;
};

const addToBlacklist = (token) => {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;   // 1 day in ms
  blacklistedTokens.push({ token, expiresAt });
};

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'No token provided' });
  const token = authHeader.split(' ')[1];

  blacklistedTokens = blacklistedTokens.filter(t => t.expiresAt > Date.now());
  if (blacklistedTokens.some(t => t.token === token)) return res.status(200).json({ message: 'Token expired' });

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Invalid token' });
    req.user = decoded;
    next(); 
  });
} 

// needed by Hardware
function pushUserUpdate(userId, data) {
  const connections= userConnections.get(userId) || [];
  connections.forEach(ws=> {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  });
}

function Verify_Hash(hash,deviceData){
    const isValidHash=(hash===sha256(deviceData));
    return isValidHash;
}

function sha256(data) {
  return crypto
    .createHmac("sha256",Hardware_SECRET_KEY)
    .update(JSON.stringify(data, Object.keys(data).sort()))
    .digest("hex");
}





const DOWNLOAD_DIR = path.join(__dirname, 'Firmware');
async function downloadAsset(tag, assetName, localFilePath,deviceCatagory) {
  try {
    const releaseResp = await axios.get(
      `https://api.github.com/repos/nanosemic/${deviceCatagory}_firmwire/releases/tags/${tag}`,{headers: {Authorization: `Bearer ${GITHUB_TOKEN}`,Accept: 'application/vnd.github.v3+json',},}
    );
    const asset = releaseResp.data.assets.find(a => a.name === assetName);

    if (!asset) throw new Error('Asset not found in release');
    const assetResp = await axios.get(asset.url, {
      responseType: 'stream',
      headers: {Authorization: `Bearer ${GITHUB_TOKEN}`,Accept: 'application/octet-stream',},
    });
    const writer = fs.createWriteStream(localFilePath);
    assetResp.data.pipe(writer);
    return new Promise((resolve, reject) => {writer.on('finish', resolve);writer.on('error', reject);});
  } catch (err) {
    throw new Error(`Failed to download asset: ${err.message}`);
  }
}




// ------------------------APP------------------------------

// LOGIN ROUTE 
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email & password are required" });
    const user = await Users.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ message: "User not found" });
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) return res.status(401).json({ message: "Invalid password" });
    const token = jwt.sign({ 
      id: user._id, 
      email: user.email
    },SECRET_KEY,{ expiresIn: "1d" });
    res.status(200).json({ token });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Login failed", error: error.message });
  }
});

app.get('/profile', authenticateToken, async (req, res) => {
  try {
    const id = req.user.id; 
    if (!id) return res.status(400).json({ message: "id is required" });
    const user = await Users.findOne({ _id:id });
    if (!user) return res.status(404).json({ message: "User not found" });
    
    return res.status(200).json({
      // id: user._id, // present in jwt
      name:user.name, 
      email: user.email
    });
  } catch (error) {
    return res.status(401).json({ message: 'Unable to fetch Profile' });
  }
});

app.patch('/login/password/reset', async (req, res) => {
  try {
    const { email, oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ message: "Both oldPassword and newPassword are required" });
    // const id = req.user.id; 

    const user = await Users.findOne({ email:email });
    if (!user) return res.status(404).json({ message: "User not found" });
    
    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) return res.status(401).json({ message: "Old password is incorrect" });
    // if (newPassword.length < 8) return res.status(400).json({message: "New password must be at least 8 characters long",});
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password=newPassword //remove in production
    user.password_hash = hashedPassword;
    // await user.save();

    return res.status(200).json({ message: "Password changed successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to reset password" });
  }
});

app.post('/register', async (req, res) => {
  try {
    const {name,email,password}=req.body;
    if(!name || !email || !password) return res.status(400).json({message: 'Name, email, and password are required'});
    const existingUser=await Users.findOne({ email: email });
    if(existingUser) return res.status(400).json({ message: 'Email already registered' });
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUser = new Users({
      name: req.body.name,
      email: req.body.email,
      password:req.body.password,
      password_hash:hashedPassword,
    });
    const savedUser = await newUser.save(); // inserts into MongoDB

    const {password: _ ,password_hash, ...userWithoutPassword}=savedUser.toObject();
    res.status(201).json(userWithoutPassword); 
  } catch (err) {
    res.status(500).json({ message: err.message,error:"erroee" });
  }
});

app.post('/logout',authenticateToken, async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader.split(' ')[1];
  console.log("🚀 \n token:", token)
  addToBlacklist(token);
  // console.log(blacklistedTokens)
  res.json({ message:"Logged out successfully"});
});

app.get('/:deviceCategory/devices', authenticateToken, async (req, res) => {
  try {
    const id = req.user.id; 
    const devices= await Terralyt.find({ 
      'user.mongoId': id 
      },
    );
    res.status(200).json({devices:devices,msg:"All devices"});
  } catch(err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to rename device' });
  }
});

app.post('/:deviceCatagory/add',authenticateToken, async (req, res) => {
  try {
    const id = req.user.id;
    const { deviceCatagory } = req.params;
    const { deviceId }=req.body;
    const { hash,...deviceData }=req.body;
    let DateTime=getDateTime()
    if (!deviceId || !deviceCatagory ) return res.status(400).json({ message: "deviceId, deviceCatagory and hash are required" });
    const existingDeviceCheck = await Terralyt.findOne({ "deviceId": deviceId });
    // if (existingDeviceCheck) return res.status(409).json({message:'Device already exists'});
    if(!Verify_Hash(hash,deviceData)) return res.status(400).json({message:'Hash does not match'}); 

    let newDevice;
    console.log(deviceData)
    switch (deviceCatagory) {
      case "Terralyt":
        newDevice = new Terralyt({
          user: { mongoId: id },
          lastUpdated:DateTime,
          deviceCatagory:deviceCatagory,
          deviceName:'Device',
          deviceId,
        });
        break;
      default:
        return res.status(404).json({ message: 'Device category not found' });
    }
    const savedDevice = await newDevice.save();
    res.status(201).json({ message: 'Device added successfully', newDevice:savedDevice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update device' });
  }
});

//dont need this   for future work
// app.patch('/:deviceCategory/:deviceId/update', authenticateToken, async (req, res) => {
//   try {
//     const id=req.user.id;
//     const {deviceId}=req.params;
//     const {sensors={}, ...updates }=req.body;
//     const DateTime=getDateTime();

//     updates.lastUpdated=DateTime;
//     const setFields={ ...updates};

//     Object.keys(sensors).forEach(key => {
//       if (key=='charts') return;
//       Object.keys(sensors[key]).forEach(e=>{ setFields[`sensors.${key}.${e}`]=sensors[key][e]});
//     });

//     const updateQuery={$set:setFields};
//     if (sensors.charts) updateQuery.$push={'sensors.charts':{$each:sensors.charts}};

//     const updatedDevice = await Terralyt.findOneAndUpdate(
//       { deviceId, 'user.mongoId': id },
//         updateQuery,
//       { new: true }
//     );

//     if (!updatedDevice) return res.status(404).json({message:'Device not found'});
//     res.json({ message:'Device updated successfully',device: updatedDevice});

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({message:'Failed to update device'});
//   }
// });

app.delete('/:deviceCategory/:deviceId/delete', authenticateToken, async (req, res) => {
  try {
    const id = req.user.id;
    const { deviceId, deviceCategory } = req.params;
    const deletedDevice = await Terralyt.findOneAndDelete({
      'user.mongoId': id,
      deviceId,
    });

    if (!deletedDevice) return res.status(404).json({ message: 'Device not found' });
    res.json({ message: 'Device deleted successfully', device: deletedDevice });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete device' });
  }
});

app.patch('/:deviceCategory/:deviceId/rename', authenticateToken, async (req, res) => {
  try {
    const id = req.user.id;
    const {deviceId,deviceCategory}=req.params;
    const {newDeviceName}= req.body;
    if (!newDeviceName) return res.status(400).json({ message: 'New device name is required' });

    const updatedDevice= await Terralyt.findOneAndUpdate(
      { deviceId, 'user.mongoId': id },
      { $set: { deviceName: newDeviceName, lastUpdated: new Date() } },
      { new: true } 
    );

    if (!updatedDevice) return res.status(404).json({message:'Device not found'});
    res.status(200).json({message:'Device renamed successfully',device:updatedDevice});

  } catch(err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to rename device' });
  }
});








// ---------------------------------Hardware-----------------------------------


app.post('/hardware/device/data', async (req, res) => {
  try {
    const {deviceId,deviceCatagory,sensors,hash}=req.body;
    const hashValue={deviceId:deviceId,deviceCatagory:deviceCatagory}
    if(!Verify_Hash(hash,hashValue)) return res.status(401).json({message:"Invalid hash"});
    
    const device = await Terralyt.findOne({"deviceId":deviceId});
    if(!device) return res.status(404).json({message:"Device is not registered with user"});
    const DateTime=getDateTime()
    
    if (!device.sensors) device.sensors = {};
    device.sensors.sensor1 = sensors.sensor1;
    device.sensors.sensor2 = sensors.sensor2;
    device.lastUpdated = DateTime;
    device.sensors.charts.day.push(
      {timestamp:DateTime, humidity: sensors.sensor1.humidity, temperature: sensors.sensor1.temperature},
    )
    await device.save(); 
    // console.log({...sensors,deviceId,charts:{timestamp:DateTime, humidity:sensors.sensor1.humidity, temperature:sensors.sensor1.temperature }})
    // pushUserUpdate(device.user.mongoId.toString(),{...sensors,deviceId,charts:{timestamp:DateTime, humidity:sensors.sensor1.humidity, temperature:sensors.sensor1.temperature}});
    return res.status(200).json({ message:"Device data saved"});
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Failed to save device data", error: error.message });
  }
});











// -------------------------     Websocket [server->app]     ----------------------------------


wss.on('connection', function connection(ws, req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1]; // Bearer <token>

  blacklistedTokens= blacklistedTokens.filter(t=> t.expiresAt > Date.now());
  if (blacklistedTokens.some(t => t.token === token)) return s.send(JSON.stringify({message:'Token expired'}));
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) { ws.send(JSON.stringify({type:'error',message:'Invalid token'})); ws.close(); return;}
    const id= decoded.id;
    ws.id= id;
    if (!userConnections.has(id)) userConnections.set(id,[]);
    userConnections.get(id).push(ws);
  }) 

  // ws.on('message', function incoming(message) {
  //   const data= JSON.parse(message);
  //   if (data.do=== "updatedData") {
  //     const targetUserId = data.targetUserId;
  //     const messageToSend = data.message;
  //     const connections = userConnections.get(targetUserId) || [];
  //     connections.forEach(conn => {
  //       if (conn.readyState === WebSocket.OPEN) {
  //           conn.send(JSON.stringify({ message: messageToSend }));
  //       }
  //     });
  //     // console.log(targetUserId,connections[0].readyState)
  //   }
  //     // pushUserUpdate("695d00845a95d7e777d03adb", { type: 'deviceUpdated', device: "updatedDevice" });
  // });


  ws.on('close',function (){
    if (ws.userId) {
      const connections= userConnections.get(ws.userId) || [];
      userConnections.set(ws.userId, connections.filter(e=> e !== ws));
    }
  });
});


















// ---------------------------------Admin-----------------------------------


 
app.post('/hardware/hash/create', async (req, res) => {
  try {
    if (!req.body.deviceId || !req.body.deviceCatagory) return res.status(400).json({ message: "deviceId and deviceCatagory are required" });
    const {hash,...deviceData} = req.body;
    const hashed = sha256(deviceData)
    return res.status(200).json({...deviceData, hash: hashed})
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Failed to create hash", error: error.message });
  }
});

app.post('/hardware/hash/verify', async (req, res) => {
  try {
    const { hash,...deviceData }=req.body;
    if (!req.body.deviceId || !req.body.deviceCatagory ) return res.status(400).json({ message: "deviceId, deviceCatagory and hash are required" });
    return res.status(200).json({valid: Verify_Hash(hash,deviceData)});
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Hash verification failed", error: error.message });
  }
});






// -------------------------------------OTA---------------------------



// Terralyt_v1.2.bin

app.post('/hardware/OTA/download', async (req, res) => {
  try {
    const {deviceId,deviceCatagory,sensors,hash}=req.body;
    const hashValue={deviceId:deviceId,deviceCatagory:deviceCatagory}
    if(!Verify_Hash(hash,hashValue)) return res.status(401).json({message:"Invalid hash"});

    const {tag} = req.body; // e.g. v1.2.3

    if (!tag){return res.status(400).json({ message: 'Tag is required' });}
    
    const assetName = `${deviceCatagory}_${tag}.bin`;
    const localFilePath = path.join(DOWNLOAD_DIR, assetName);


    if (!fs.existsSync(localFilePath)) {
      console.log('Downloading firmware from GitHub...');
      await downloadAsset(tag,assetName,localFilePath,deviceCatagory);
      console.log('Firmware downloaded successfully.');
    } else {
      console.log('Using cached firmware file.');
    }

    const fileStats=fs.statSync(localFilePath)
    const fileSize=fileStats.size

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${assetName}"`);
    res.setHeader('Content-Length', fileSize);

    const fileStream = fs.createReadStream(localFilePath);
    fileStream.pipe(res);


  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Failed to serve firmware' });
  }
});




app.post('/hardware/OTA/check', async (req, res) => {
  try {
    const {deviceId,deviceCatagory,sensors,hash}=req.body;
    const hashValue={deviceId:deviceId,deviceCatagory:deviceCatagory}
    if(!Verify_Hash(hash,hashValue)) return res.status(401).json({message:"Invalid hash"});

    const resp = await axios.get(
      `https://api.github.com/repos/nanosemic/${deviceCatagory}_firmwire/tags`,{headers: {Authorization: `Bearer ${GITHUB_TOKEN}`,Accept: 'application/vnd.github.v3+json',},}
    );
    const tags = resp.data.map(tag => tag.name);
    res.json({tags: tags});
    
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Failed to serve firmware' });
  }
});















// -------------------------------  Test -----------------------------------

app.get('/hello', (req, res) => {
  res.json({ message: "Hello from server!" });
});


// app.listen(PORT, () => {
//   console.log(`Server running at http://localhost:${PORT}`);
// });

// for vercel-----------------------------------

module.exports = app;