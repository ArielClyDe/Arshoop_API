const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log('Cloudinary config:', {
  cloud_name: JSON.stringify(process.env.CLOUDINARY_CLOUD_NAME),
  api_key: JSON.stringify(process.env.CLOUDINARY_API_KEY),
});
console.log('Raw CLOUDINARY_CLOUD_NAME:', JSON.stringify(process.env.CLOUDINARY_CLOUD_NAME));




module.exports = cloudinary;
