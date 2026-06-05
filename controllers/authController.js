import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import UserModel from "../models/userModel.js";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-this";

const authController = {
  async signup(req, res) {
    console.log("📩 Received signup request:", req.body);
    const { name, email, password, confirmPassword, phone, date_of_birth, gender } = req.body;

    // Basic validation
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ 
        success: false,
        message: "All fields are required" 
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        success: false,
        message: "Passwords do not match" 
      });
    }

    try {
      // Check if user already exists
      const existingUser = await UserModel.findByEmail(email);
      
      if (existingUser) {
        return res.status(409).json({ 
          success: false,
          message: "User already exists" 
        });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create new user
      const userId = await UserModel.create(name, email, hashedPassword);

      // Save optional profile data if provided
      if (phone || date_of_birth || gender) {
        await UserModel.updateProfile(userId, {
          phone: phone || null,
          date_of_birth: date_of_birth || null,
          gender: gender || null,
          bio: null,
          avatar_url: null,
        });
      }

      // Generate JWT Token  (userId is already a string from UserModel.create)
      const token = jwt.sign(
        { id: userId, email },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      console.log("✅ User signed up successfully:", email);
      res.status(201).json({ 
        success: true,
        message: "Signup successful", 
        token,
        user: { id: userId, name, email }
      });
    } catch (error) {
      console.error("❌ Signup error:", error);
      res.status(500).json({ 
        success: false,
        message: "Server error during signup" 
      });
    }
  },

  // User Login
  async login(req, res) {
    console.log("📩 Received login request:", req.body);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        message: "Email and password are required" 
      });
    }

    try {
      const user = await UserModel.findByEmail(email);
      
      if (!user) {
        return res.status(401).json({ 
          success: false,
          message: "User not found" 
        });
      }

      if (!user.password) {
        return res.status(401).json({ 
          success: false,
          message: "This account uses Google Login. Please sign in with Google." 
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(401).json({ 
          success: false,
          message: "Invalid credentials" 
        });
      }

      // Generate JWT Token — use _id (ObjectId string) not .id which is undefined on lean()
      const mongoId = user._id.toString();
      const token = jwt.sign(
        { id: mongoId, email: user.email },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      console.log("✅ Login successful for:", email);
      return res.json({ 
        success: true,
        message: "Login successful", 
        token,
        user: { id: mongoId, name: user.name, email: user.email }
      });
    } catch (error) {
      console.error("❌ Login error:", error);
      return res.status(500).json({ 
        success: false,
        message: "Server error during login" 
      });
    }
  },

  // Get current user info
  async getCurrentUser(req, res) {
    try {
      const user = await UserModel.findById(req.user.id);
      
      if (!user) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      res.json({ 
        success: true,
        user 
      });
    } catch (error) {
      console.error("❌ Get user error:", error);
      res.status(500).json({ 
        success: false,
        message: "Server error" 
      });
    }
  },

  // Redirect to Google Consent screen
  googleAuth(req, res) {
    try {
      const callbackUrl = authController.getCallbackUrl(req);
      console.log("🚀 Google OAuth callback URL selected:", callbackUrl);
      const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        callbackUrl
      );

      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: [
          "https://www.googleapis.com/auth/userinfo.profile",
          "https://www.googleapis.com/auth/userinfo.email",
        ],
        prompt: "consent",
      });

      res.redirect(authUrl);
    } catch (error) {
      console.error("❌ Google auth redirect error:", error);
      res.status(500).json({ success: false, message: "Google auth initialization failed" });
    }
  },

  // Google OAuth callback
  async googleCallback(req, res) {
    try {
      const { code } = req.query;
      if (!code) {
        return res.redirect(`${authController.getFrontendUrl(req)}/login?error=Google auth failed: missing code`);
      }

      const client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        authController.getCallbackUrl(req)
      );

      // Exchange code for tokens
      const { tokens } = await client.getToken(code);
      client.setCredentials(tokens);

      // Verify ID Token
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      const { sub: googleId, email, name, picture } = payload;

      // Find or create user
      let user = await UserModel.findByGoogleId(googleId);
      
      if (!user) {
        // Also check by email to link accounts if they signed up traditionally first
        user = await UserModel.findByEmail(email);
        if (user) {
          // Link googleId to existing account
          await UserModel.update(user._id.toString(), { googleId, avatar_url: user.avatar_url || picture });
          user = await UserModel.findById(user._id.toString());
        } else {
          // Create new Google user
          const userId = await UserModel.createGoogleUser(name, email, googleId, picture);
          user = await UserModel.findById(userId);
        }
      }

      // Generate JWT Token
      const mongoId = user._id ? user._id.toString() : user.id;
      const token = jwt.sign(
        { id: mongoId, email: user.email },
        JWT_SECRET,
        { expiresIn: "24h" }
      );

      console.log("✅ Google Login successful for:", user.email);
      
      // Redirect to frontend with token
      res.redirect(`${authController.getFrontendUrl(req)}/?token=${token}`);
    } catch (error) {
      console.error("❌ Google callback error:", error);
      res.redirect(`${authController.getFrontendUrl(req)}/login?error=Google authentication failed`);
    }
  },

  // Helpers to get URLs dynamically based on request context
  getCallbackUrl(req) {
    const host = req.get("host");
    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      return "http://localhost:3000/auth/google/callback";
    }
    // Production callback whitelisted in Google Developer Console
    return "https://psychoish.khushagra.in/auth/google/callback";
  },

  getFrontendUrl(req) {
    if (process.env.FRONTEND_URL) {
      return process.env.FRONTEND_URL;
    }
    const host = req.get("host");
    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      return "http://localhost:3000";
    }
    // Production frontend URL
    return "https://psychoish.khushagra.in";
  },
};

export default authController;
