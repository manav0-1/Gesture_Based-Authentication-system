const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const File = require('../models/File');
const { protect } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  }
});
const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|sh|ps1|dll|msi|com|scr|pif)$/i;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (BLOCKED_EXTENSIONS.test(file.originalname)) {
      return cb(new Error('This file type is not allowed.'));
    }
    cb(null, true);
  },
});

// ─── Routes ───────────────────────────────────────────────────

// @route   POST /api/files
// @desc    Upload a new file
// @access  Private
router.post('/', protect, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.` });
      }
      return res.status(400).json({ message: err.message || 'File upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file provided' });
    }

    const { originalname, filename, mimetype, size, path: filePath } = req.file;

    const newFile = await File.create({
      user: req.user._id,
      originalname,
      filename,
      mimetype,
      size,
      path: filePath,
    });

    logger.info(`File uploaded: ${originalname} by user ${req.user.username}`);
    res.status(201).json(newFile);
  } catch (err) {
    logger.error(`Upload error: ${err.message}`);
    res.status(500).json({ message: 'Server error during file upload' });
  }
});

// @route   GET /api/files
// @desc    Get all files for logged-in user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const files = await File.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(files);
  } catch (err) {
    logger.error(`Fetch files error: ${err.message}`);
    res.status(500).json({ message: 'Server error fetching files' });
  }
});

// @route   GET /api/files/view/:id
// @desc    Securely view/download a file
// @access  Private
router.get('/view/:id', protect, async (req, res) => {
  try {
    const fileRecord = await File.findOne({ _id: req.params.id, user: req.user._id });
    if (!fileRecord) {
      return res.status(404).json({ message: 'File not found or unauthorized' });
    }

    const filePath = path.join(__dirname, '../uploads', fileRecord.filename);
    
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', fileRecord.mimetype);
      res.setHeader('Content-Disposition', `inline; filename="${fileRecord.originalname}"`);
      return res.sendFile(filePath);
    } else {
      return res.status(404).json({ message: 'File missing from server storage' });
    }
  } catch (err) {
    logger.error(`View file error: ${err.message}`);
    res.status(500).json({ message: 'Server error viewing file' });
  }
});

// @route   PUT /api/files/:id
// @desc    Rename a file (only changing originalname metadata)
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName) {
      return res.status(400).json({ message: 'New filename is required' });
    }

    const fileRecord = await File.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { originalname: newName },
      { new: true }
    );

    if (!fileRecord) {
      return res.status(404).json({ message: 'File not found or unauthorized' });
    }

    logger.info(`File renamed to ${newName} by user ${req.user.username}`);
    res.json(fileRecord);
  } catch (err) {
    logger.error(`Rename file error: ${err.message}`);
    res.status(500).json({ message: 'Server error renaming file' });
  }
});

// @route   DELETE /api/files/:id
// @desc    Delete a file database record and associated physical file
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const fileRecord = await File.findOne({ _id: req.params.id, user: req.user._id });
    if (!fileRecord) {
      return res.status(404).json({ message: 'File not found or unauthorized' });
    }

    // Remove from physical storage securely using dynamic path resolution
    const filePath = path.join(__dirname, '../uploads', fileRecord.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    } else {
      logger.warn(`File ${filePath} not found on disk during deletion, cleaning up DB record anyway.`);
    }

    // Remove from database
    await File.deleteOne({ _id: fileRecord._id });

    logger.info(`File deleted: ${fileRecord.originalname} by user ${req.user.username}`);
    res.json({ message: 'File successfully deleted' });
  } catch (err) {
    logger.error(`Delete file error: ${err.message}`);
    res.status(500).json({ message: 'Server error deleting file' });
  }
});

module.exports = router;
