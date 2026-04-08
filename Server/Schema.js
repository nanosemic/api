const mongoose = require('mongoose');
 
const UserSchema= new mongoose.Schema({
    name: String,
    email: String,
    password: String,
    password_hash: String,
    userId: String
},{versionKey:false})     
const Users = mongoose.model('users', UserSchema);



const TerralytSchema = new mongoose.Schema({
  user: {
    mongoId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  },
  lastUpdated: { type:Date},
  deviceCatagory:{type:String,required:true},
  deviceId: {type:String,required: true},
  deviceName:{type:String,required:true},
  status:{type:String,default:'off'},
  firmwareVersion:{type:String,default:'1.0.0'},
  macAddress:{type:String},
  lastUpdated:{type:Date},
  sensors:{
    sensor1:{
      humidity:{type:Number},
      soilHardness:{type:Number},
      temperature:{type:Number}
    },
    sensor2:{
      humidity:{type:Number},
      soilHardness:{type:Number},
      temperature:{type:Number}
    },
    charts: {
      day: [
        { _id: false,
          timestamp:{type:Date,required:true},
          humidity:{type:Number,required:true},
          temperature:{type:Number,required: true }
        }
      ],
      week: [
        { _id: false,
          timestamp:{type:Date,required:true},
          humidity:{type:Number,required:true},
          temperature:{type:Number,required: true}
        }
      ],
    }
  },
}, { versionKey: false});




const Terralyt = mongoose.model('terralyts', TerralytSchema);

module.exports = {Users,Terralyt}



