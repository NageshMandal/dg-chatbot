// callback.js

module.exports = {
    submitEnrollmentData: async function ({ session_id, tempForm, course }) {
      console.log("[CALLBACK] submitEnrollmentData invoked:", {
        session_id,
        course,
        tempForm
      });
      // 🔄 Replace this with DB logic or API integration
      return {
        status: "success",
        message: "Enrollment recorded",
        course,
        form: tempForm
      };
    },
  
    logSupportRequest: async function ({ session_id, message }) {
      console.log("[CALLBACK] logSupportRequest:", { session_id, message });
      return { status: "logged" };
    },
  
    storeUserFeedback: async function ({ session_id, message }) {
      console.log("[CALLBACK] storeUserFeedback:", { session_id, feedback: message });
      return { status: "feedback_received" };
    }
  };
  