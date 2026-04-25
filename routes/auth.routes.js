import express from "express";
import {
  checkEmail,
  checkMobile,       
  signup,
  emailLogin,
  sendEmailOtp,
  verifyEmailOtp,
  sendMobileOtp,
  verifyMobileOtp,
  googleLogin, 
  getMe,
  createData,
  getAllData,
  getDataById
} from "../controller/auth.controller.js"
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router(); 
router.post("/check-email",  checkEmail);
router.post("/check-mobile", checkMobile); 
router.post("/signup", signup); 
router.post("/email-login", emailLogin); 
router.post("/verify-email-otp", verifyEmailOtp); 
router.post("/send-email-otp", sendEmailOtp); 
router.post("/send-mobile-otp",   sendMobileOtp); 
router.post("/verify-mobile-otp", verifyMobileOtp); 
router.post("/google-login", googleLogin); 
router.get("/me", protect, getMe);


//json data apI

router.post("/data", createData);
router.get("/data", getAllData);
router.get("/data/:id", getDataById);
export default router;