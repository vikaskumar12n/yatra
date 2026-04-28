import { generateOtp } from "../utils/otp.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import dotenv from "dotenv";

import { OAuth2Client } from "google-auth-library";
import twilioClient from "../utils/twilio.js";
import { executeBothDB } from "../helper/dbhelper.js";

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
dotenv.config();
 
export const checkEmail = async (req, res) => {
  try {
    const { email } = req.body;

    // 🔴 Validation
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
        field: "email",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 🔍 Check in DB
    const result = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    const exists = result.rows.length > 0;

    // ✅ Success response
    return res.status(200).json({
      success: true,
      exists,
      message: exists
        ? "Email already registered"
        : "Email not registered",
      flow: exists ? "LOGIN" : "SIGNUP",
      next_action: exists ? "LOGIN_WITH_PASSWORD" : "COMPLETE_SIGNUP",
    });

  } catch (err) {
    console.error("[checkEmail]", err.message);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while checking email",
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
    const result = await executeBothDB({
  query: "SELECT id FROM users WHERE mobile = $1",
  values: [normalizedMobile],
  pool,
  type: "read",
});

const exists = result.data.length > 0;
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

    // 🔴 Basic validation
    if (!email || !password || !mobile || !role) {
      return res.status(400).json({
        success: false,
        message: "Email, password, mobile aur role required hai",
      });
    }

    // 🔥 Role based validation
    if (role === "PERSONAL" && !fullName) {
      return res.status(400).json({
        success: false,
        message: "Full name required for PERSONAL account",
      });
    }

    if (role === "SME" && !companyName) {
      return res.status(400).json({
        success: false,
        message: "Company name required for SME account",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedMobile = mobile.trim();

    // 🔍 Check existing user
    const check = await pool.query(
      "SELECT id FROM users WHERE email=$1 OR mobile=$2",
      [normalizedEmail, normalizedMobile]
    );

    if (check.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
      });
    }

    // 🔐 Password hash
    const hash = await bcrypt.hash(password, 10);

    // 🧠 INSERT FULL DATA
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
        hash,
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

    // 🔒 Remove sensitive
    delete user.password;
    delete user.otp;
    delete user.otpexpiry;

    return res.status(201).json({
      success: true,
      message: "Signup successful",
      user,
    });

  } catch (err) {
    console.error("[signup ERROR]", err);

    return res.status(500).json({
      success: false,
      message: err.message,
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

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    // 🔐 Password check
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: "Password not set. Try Google login.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password",
      });
    }

    // 🔑 Token
    const token = generateToken(user.id);

    // 🔒 Remove sensitive fields
    delete user.password;
    delete user.otp;
    delete user.otpexpiry;

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user,
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

    const result = await pool.query(
      `UPDATE users 
       SET otp = $1, otpexpiry = $2 
       WHERE email = $3 
       RETURNING *`,
      [otp, otpExpiry, normalizedEmail]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log(`📧 OTP for ${email}: ${otp}`);

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      flow: "OTP",
      next_action: "VERIFY_EMAIL_OTP",
    });

  } catch (err) {
    console.error("[sendEmailOtp ERROR]", err);

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

    // ✅ STEP 1: FIND USER
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

    // ❌ OTP CHECK
    if (user.otp !== String(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // ❌ EXPIRY CHECK
    if (!user.otpexpiry || new Date(user.otpexpiry) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    // ✅ UPDATE USER
    const updated = await pool.query(
      `UPDATE users 
       SET isemailverified = true, otp = NULL, otpexpiry = NULL 
       WHERE email = $1 
       RETURNING *`,
      [normalizedEmail]
    );

    const safeUser = updated.rows[0];

    const token = generateToken(safeUser.id);

    delete safeUser.password;
    delete safeUser.otp;
    delete safeUser.otpexpiry;

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
      token,
      user: safeUser,
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
        message: "Mobile is required",
      });
    }

    const normalizedMobile = mobile.trim();

    const { otp, otpExpiry } = otpPayload();

    // 🔥 update user with OTP
    const result = await pool.query(
      `UPDATE users 
       SET otp = $1, otpexpiry = $2 
       WHERE mobile = $3 
       RETURNING id`,
      [otp, otpExpiry, normalizedMobile]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found with this mobile number",
      });
    }

    console.log("📲 OTP SENT:", otp);

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      mobile: normalizedMobile,
      // ⚠️ remove in production
      otp: otp,
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
console.log("REQUEST BODY:", req.body);
if (!mobile || !otp) {
  return res.status(400).json({
    success: false,
        message: "Mobile and OTP are required",
      });
    }

    const normalizedMobile = mobile.trim();
    
    console.log("NORMALIZED MOBILE:", normalizedMobile);
    // 🔍 find user
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
    
    console.log("DB OTP:", user.otp);
    console.log("INPUT OTP:", otp);
    
    console.log("OTP FROM USER:", otp);
    // ❌ OTP match
    if (String(user.otp) !== String(otp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // ❌ expiry check
    if (!user.otpexpiry || new Date(user.otpexpiry) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    // ✅ verify user
    const updated = await pool.query(
      `UPDATE users 
       SET ismobileverified = true, otp = NULL, otpexpiry = NULL 
       WHERE mobile = $1 
       RETURNING *`,
      [normalizedMobile]
    );

    const safeUser = updated.rows[0];

    if (!safeUser) {
      return res.status(500).json({
        success: false,
        message: "Failed to update user",
      });
    }

    const token = generateToken(safeUser.id);

    // 🔒 remove sensitive data
    delete safeUser.password;
    delete safeUser.otp;
    delete safeUser.otpexpiry;

    return res.status(200).json({
      success: true,
      message: "Mobile verified successfully",
      token,
      user: safeUser,
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

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: userId missing",
      });
    }

    // 🔍 fetch user
    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    // 🔒 remove sensitive data
    delete user.password;
    delete user.otp;
    delete user.otpexpiry;

    return res.status(200).json({
      success: true,
      message: "User fetched successfully",
      user,
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

    const query = `
      INSERT INTO dynamic_data (data)
      VALUES ($1)
      RETURNING *
    `;

    const result = await pool.query(query, [jsonData]);

    return res.status(201).json({
      success: true,
      message: "Data created successfully",
      data: result.rows[0],
    });

  } catch (err) {
    console.error("[createData]", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
export const getAllData = async (req, res) => {
  try {
    const query = "SELECT * FROM dynamic_data ORDER BY id DESC";

    const result = await pool.query(query);

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: result.rows,
    });

  } catch (err) {
    console.error("[getAllData]", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
export const getDataById = async (req, res) => {
  try {
    const { id } = req.params;

    const query = "SELECT * FROM dynamic_data WHERE id = $1";

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: result.rows[0],
    });

  } catch (err) {
    console.error("[getDataById]", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};