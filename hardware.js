const express = require('express');
const cors = require('cors');
const crypto = require("crypto");


const app = express();
const PORT = 8082;
// const SECRET_KEY = '1234';
const Hardware_SECRET_KEY='456';
app.use(cors());
app.use(express.json());


console.clear()     

// --------------------------Functions---------------------------


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


// ---------------------------------Hardware-----------------------------------


app.post('/hardware/device/data', async (req, res) => {
  try {
    const {deviceId,deviceCatagory,sensors,hash}=req.body;
    const hashValue={deviceId:deviceId,deviceCatagory:deviceCatagory}
    if(!Verify_Hash(hash,hashValue)) return res.status(401).json({message:"Invalid hash"});
    
    console.log("req.body",req.body)
    // mongo db oparations------------------------
    //Web socket----------------------------

    return res.status(200).json({ message:"Device data saved"});
  } catch (error) {
    console.log(error)
    return res.status(500).json({ message: "Failed to save device data", error: error.message });
  }
});

 
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






 


  










// -------------------------------  Test -----------------------------------

app.get('/hello', (req, res) => {
  res.json({ message: "Hello from server!" });
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
