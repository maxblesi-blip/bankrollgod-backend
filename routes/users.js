// routes/users.js
// User Profile Management Routes for BankrollGod Backend

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

// GET - Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PUT - Update user profile (nickname, email, names, etc.)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { username, nickname, email, first_name, last_name } = req.body;
    const userId = req.user.id;

    // Validation
    if (!username || !email) {
      return res.status(400).json({
        success: false,
        message: 'Username and email are required'
      });
    }

    // Check if username/email already exists (exclude current user)
    const existingUser = await User.findOne({
      $and: [
        { _id: { $ne: userId } },
        { $or: [{ username }, { email }] }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already exists'
      });
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        username, 
        nickname, 
        email, 
        first_name, 
        last_name,
        updated_at: new Date()
      },
      { 
        new: true, 
        runValidators: true,
        select: '-password' 
      }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Profile update error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error: ' + error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PUT - Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Get user with password
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await User.findByIdAndUpdate(userId, {
      password: hashedNewPassword,
      updated_at: new Date()
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PUT - Update privacy settings
router.put('/privacy', authenticateToken, async (req, res) => {
  try {
    const { profilePublic, showStats, allowMessages, dataSharing } = req.body;
    const userId = req.user.id;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        profilePublic: Boolean(profilePublic),
        showStats: Boolean(showStats),
        allowMessages: Boolean(allowMessages),
        dataSharing: Boolean(dataSharing),
        updated_at: new Date()
      },
      { 
        new: true, 
        select: '-password' 
      }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Privacy settings updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Privacy update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// DELETE - Delete user account
router.delete('/delete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Delete user's related data first
    const Bankroll = require('../models/Bankroll');
    const Session = require('../models/Session');
    const Game = require('../models/Game');

    // Clean up user's data
    await Bankroll.deleteMany({ user_id: userId });
    await Session.deleteMany({ user_id: userId });
    await Game.deleteMany({ user_id: userId });

    // Delete user
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Account and all associated data deleted successfully'
    });

  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;