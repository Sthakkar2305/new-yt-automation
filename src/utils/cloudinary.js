import { v2 as cloudinary } from 'cloudinary';
import config from '../config/index.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('cloudinary');

// Initialize
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

/**
 * Upload a file to Cloudinary.
 * @param {string} filePath - Local file path
 * @param {string} folder - Cloudinary folder
 * @param {string} resourceType - 'image', 'video', 'raw'
 */
export async function uploadToCloudinary(filePath, folder = 'yt-shorts', resourceType = 'auto') {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder,
      resource_type: resourceType,
      overwrite: true,
      quality: 'auto:good',
    });

    logger.info(`Uploaded to Cloudinary: ${result.public_id}`);
    return {
      url: result.secure_url,
      publicId: result.public_id,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (err) {
    logger.error('Cloudinary upload failed', { error: err.message });
    throw err;
  }
}

/**
 * Delete a file from Cloudinary.
 */
export async function deleteFromCloudinary(publicId, resourceType = 'image') {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    logger.info(`Deleted from Cloudinary: ${publicId}`);
  } catch (err) {
    logger.warn(`Cloudinary delete failed: ${publicId}`, { error: err.message });
  }
}

export default { uploadToCloudinary, deleteFromCloudinary };
