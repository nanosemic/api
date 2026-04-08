// const cron = require('node-cron');
// const { Terralyt } = require('./Schema');

// cron.schedule('0 0 * * *', async () => {
//   try {

//     // Update all devices, set charts.day = []
//     const result = await Terralyt.updateMany(
//       {}, // match all devices
//       { $set: { 'sensors.charts.day': [] } }
//     );

//     console.log(`✅ Reset charts.day for ${result.modifiedCount} devices`);
//   } catch (err) {
//     console.error('❌ Failed to reset charts.day:', err);
//   }
// }, {
//   timezone: "Asia/Kolkata" // optional, set your timezone
// });
