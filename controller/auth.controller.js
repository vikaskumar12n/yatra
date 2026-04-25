import { generateOtp } from "../utils/otp.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import { OAuth2Client } from "google-auth-library";
import twilioClient from "../utils/twilio.js";

const googleAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); 
const generateToken = (userId, expiresIn = "7d") =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn }); 
const safeUser = (doc) => {
  const { password, otp, otpExpiry, __v, ...rest } = doc._doc ?? doc.toObject();
  return rest;
}; 
// BUG FIX: was 5 * 60 * 90000 = 450 minutes. Correct: 5 * 60 * 1000 = 5 minutes
const otpPayload = () => ({
  otp: generateOtp(),
  otpExpiry: new Date(Date.now() + 5 * 60 * 1000),
}); 
export const checkEmail = async (req, res) => {
  try {
    const { email } = req.body; 
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    } 
    const normalizedEmail = email.toLowerCase().trim();

    // PostgreSQL Query
    const result = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    const exists = result.rows.length > 0;

    return res.status(200).json({
      success: true,
      exists,
      message: exists
        ? "Email already registered"
        : "Email not registered",
      flow: exists ? "LOGIN" : "SIGNUP",
      ...(exists ? {} : { next_action: "COMPLETE_SIGNUP" }),
    });

  } catch (err) {
    console.error("[checkEmail]", err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
}; 
export const checkMobile = async (req, res) => {
  try {
    const { mobile } = req.body;
 
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });
    }

    const normalizedMobile = mobile.trim();

    // 🔍 PostgreSQL Query
    const result = await pool.query(
      "SELECT id FROM users WHERE mobile = $1",
      [normalizedMobile]
    );

    const exists = result.rows.length > 0;

    return res.status(200).json({
      success: true,
      exists,
      message: exists
        ? "Mobile already registered"
        : "Mobile not registered",
      flow: exists ? "LOGIN" : "SIGNUP",
      ...(exists
        ? { next_action: "SEND_MOBILE_OTP" }
        : { next_action: "COMPLETE_SIGNUP" }),
    });

  } catch (err) {
    console.error("[checkMobile]", err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};  
export const signup = async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      mobile,
      gender,
      role,
      companyName,
      gstNumber,
      companyAddress,
      city,
      state,
      pincode,
    } = req.body;
 
    if (!email || !password || !mobile || !role) {
      return res.status(400).json({
        success: false,
        message: "Email, mobile, password and role are required",
      });
    }

    if (role === "PERSONAL" && !fullName) {
      return res.status(400).json({
        success: false,
        message: "Full name is required for personal account",
      });
    }

    if (role === "SME" && !companyName) {
      return res.status(400).json({
        success: false,
        message: "Company name is required for SME account",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedMobile = mobile.trim();

    // 🔍 Check existing user
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1 OR mobile = $2",
      [normalizedEmail, normalizedMobile]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists with email or mobile",
      });
    }

    // 🔐 Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // 🧠 Insert user
    const result = await pool.query(
      `INSERT INTO users (
        fullname, email, password, mobile, gender, role,
        companyname, gstnumber, companyaddress, city, state, pincode,
        isemailverified, ismobileverified
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,
        $13,$14
      ) RETURNING *`,
      [
        fullName || null,
        normalizedEmail,
        hashedPassword,
        normalizedMobile,
        gender || null,
        role,
        companyName || null,
        gstNumber || null,
        companyAddress || null,
        city || null,
        state || null,
        pincode || null,
        false,
        false,
      ]
    );

    const user = result.rows[0];

    // 🔥 sensitive remove
    delete user.password;
    delete user.otp;
    delete user.otpexpiry;

    return res.status(201).json({
      success: true,
      message: "Account created. Please verify your email.",
      flow: "OTP",
      purpose: "EMAIL_VERIFY",
      next_action: "SEND_EMAIL_OTP",
      user,
    });

  } catch (err) {
    console.error("[signup]", err);

    return res.status(500).json({
      success: false,
      message: "Signup failed",
    });
  }
}; 
export const emailLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 🔴 Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 🔍 Find user
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [normalizedEmail]
    );

    const invalidCreds = {
      success: false,
      message: "Invalid email or password",
    };

    if (result.rows.length === 0) {
      return res.status(401).json(invalidCreds);
    }

    const user = result.rows[0];

    // 🔐 Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json(invalidCreds);
    }

    // 🔐 Generate JWT 
const token = generateToken(user);
    // Remove sensitive fields
    delete user.password;
    delete user.otp;
    delete user.otpexpiry;

    return res.status(200).json({
      success: true,
      message: "Login successful",

      token,
      user,

      flow: "LOGIN",
      next_action: "LOGIN_SUCCESS",
    });

  } catch (err) {
    console.error("[emailLogin]", err);

    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
}; 
export const sendEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const { otp, otpExpiry } = otpPayload();

    // 🔍 Update user OTP
    const result = await pool.query(
      `UPDATE users 
       SET otp = $1, otpexpiry = $2 
       WHERE email = $3 
       RETURNING *`,
      [otp, otpExpiry, normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 📧 (TEMP) console me OTP
    console.log(`[sendEmailOtp] OTP for ${email}: ${otp}`);

    return res.status(200).json({
      success: true,
      message: "OTP sent to your email",
      flow: "OTP",
      purpose: "EMAIL_VERIFY",
      next_action: "VERIFY_EMAIL_OTP",
    });

  } catch (err) {
    console.error("[sendEmailOtp]", err);

    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
    });
  }
}; 
export const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 🔍 Find user
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    // 🔥 OTP match
    if (user.otp !== String(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // 🔥 expiry check
    if (!user.otpexpiry || new Date(user.otpexpiry) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    // ✅ verify + cleanup
    const updated = await pool.query(
      `UPDATE users 
       SET isemailverified = true, otp = NULL, otpexpiry = NULL 
       WHERE email = $1 
       RETURNING *`,
      [normalizedEmail]
    );

    const safeUser = updated.rows[0]; 
    const token =generateToken(safeUser.id)
    
    delete safeUser.password;
    delete safeUser.otp;
    delete safeUser.otpexpiry;

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",

      token,
      user: safeUser,

      flow: "LOGIN",
      next_action: "EMAIL_VERIFIED",
    });

  } catch (err) {
    console.error("[verifyEmailOtp]", err);

    return res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
};
export const sendMobileOtp = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });
    }

    const normalizedMobile = mobile.trim();

    // 🔍 Check user
    const result = await pool.query(
      "SELECT * FROM users WHERE mobile = $1",
      [normalizedMobile]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { otp, otpExpiry } = otpPayload();

    // 🔥 Update OTP
    await pool.query(
      "UPDATE users SET otp = $1, otpexpiry = $2 WHERE mobile = $3",
      [otp, otpExpiry, normalizedMobile]
    );

    // 📲 Send SMS
  const message = await twilioClient.messages.create({
  body: `Your OTP is ${otp}. Valid for 5 minutes.`,
  from: process.env.TWILIO_PHONE_NUMBER,
  to: `+91${normalizedMobile}`,
});

console.log("SMS RESPONSE 👉", message);

    return res.status(200).json({
      success: true,
      message: "OTP sent to your mobile",
      flow: "OTP",
      purpose: "MOBILE_VERIFY",
      next_action: "VERIFY_MOBILE_OTP",
    });

  } catch (err) {
    console.error("[sendMobileOtp]", err);

    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
    });
  }
}; 
export const verifyMobileOtp = async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: "Mobile and OTP are required",
      });
    }

    const normalizedMobile = mobile.trim();

    // 🔍 Find user
    const result = await pool.query(
      "SELECT * FROM users WHERE mobile = $1",
      [normalizedMobile]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    // 🔥 OTP match
    if (user.otp !== String(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // 🔥 expiry check
    if (!user.otpexpiry || new Date(user.otpexpiry) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    // ✅ verify + cleanup
    const updated = await pool.query(
      `UPDATE users 
       SET ismobileverified = true, otp = NULL, otpexpiry = NULL 
       WHERE mobile = $1 
       RETURNING *`,
      [normalizedMobile]
    );

    const safeUser = updated.rows[0]; 
    
    const token=generateToken(safeUser.id)

    delete safeUser.password;
    delete safeUser.otp;
    delete safeUser.otpexpiry;

    return res.status(200).json({
      success: true,
      message: "Mobile verified successfully",
      token,
      user: safeUser,
      flow: "LOGIN",
      next_action: "MOBILE_VERIFIED",
    });

  } catch (err) {
    console.error("[verifyMobileOtp]", err);

    return res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
}; 
 export const googleLogin = async (req, res) => {
  try {
    const { googleToken } = req.body;

    if (!googleToken) {
      return res.status(400).json({
        success: false,
        message: "Google token is required",
      });
    }

    const ticket = await googleAuthClient.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { email, name, picture, sub: googleId } = ticket.getPayload();

    // 🔍 Check user
    let result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    let user;

    if (result.rows.length === 0) {
      // 🆕 Create user
      const insert = await pool.query(
        `INSERT INTO users (fullname, email, googleid, avatar, isemailverified)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [name, email, googleId, picture, true]
      );

      user = insert.rows[0];
    } else {
      user = result.rows[0];

      // 🔄 Update if needed
      if (!user.googleid) {
        const update = await pool.query(
          `UPDATE users SET googleid=$1, avatar=$2 WHERE email=$3 RETURNING *`,
          [googleId, picture, email]
        );
        user = update.rows[0];
      }
    } 
    const token = generateToken(user.id, user.email);

    delete user.password;

    return res.status(200).json({
      success: true,
      message: "Google login successful",
      token,
      user,
    });

  } catch (err) {
    console.error("[googleLogin]", err);

    return res.status(401).json({
      success: false,
      message: "Google authentication failed",
    });
  }
}; 
export const getMe = async (req, res) => {
  try {
    const userId = req.user.id;

    // WHERE id = $1"
  const result = await pool.query("SELECT * FROM users");

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

  const users = result.rows.map(user => {
  delete user.password;
  delete user.otp;
  delete user.otpexpiry;
  return user;
});

    return res.status(200).json({
      success: true,
      users,
    });

  } catch (err) {
    console.error("[getMe]", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch user",
    });
  }
};


// /create dynmaic json data 
export const createData = async (req, res) => {
  try {
    const jsonData = req.body;  

    const result = await pool.query(
      "INSERT INTO dynamic_data (data) VALUES ($1) RETURNING *",
      [jsonData]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
export const getAllData = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM dynamic_data ORDER BY id DESC"
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
export const getDataById = async (req, res) => {
  try {
    const { id } = req.params;

    // ❗ validation
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID is required",
      });
    }

    const result = await pool.query(
      "SELECT * FROM dynamic_data WHERE id = $1",
      [id]
    );

    // ❗ not found
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data not found",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};