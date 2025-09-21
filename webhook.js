// ====== 1. IMPORT LIBRARIES ======
const twilio = require('twilio');
const dialogflow = require('@google-cloud/dialogflow');
const admin = require('firebase-admin');

// ====== 2. CONFIGURE YOUR CLIENTS ======
const DIALOGFLOW_PROJECT_ID = process.env.DIALOGFLOW_PROJECT_ID;
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

// Initialize Dialogflow Client
const sessionClient = new dialogflow.SessionsClient({
    credentials: {
        client_email: GOOGLE_CREDENTIALS.client_email,
        private_key: GOOGLE_CREDENTIALS.private_key,
    },
});

// Initialize Firebase Admin (ensures it only runs once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(GOOGLE_CREDENTIALS),
  });
}
const db = admin.firestore();


// ====== 3. THE MAIN FUNCTION ======
module.exports = async (req, res) => {
    const userMessage = req.body.Body;
    const userPhoneNumber = req.body.From;
    const sessionPath = sessionClient.projectAgentSessionPath(DIALOGFLOW_PROJECT_ID, userPhoneNumber);

    const request = {
        session: sessionPath,
        queryInput: {
            text: {
                text: userMessage,
                languageCode: 'en-US',
            },
        },
    };

    try {
        const responses = await sessionClient.detectIntent(request);
        const result = responses[0].queryResult;
        const intentName = result.intent.displayName;
        let responseMessage = result.fulfillmentText; // Default response

        // LOGIC FOR DATABASE-DRIVEN Q&A
        if (intentName === 'query_health_database') {
            const topic = result.parameters.fields['health_topic'].stringValue;
            if (topic) {
                const knowledgeBase = db.collection('knowledge_base');
                const snapshot = await knowledgeBase.where('keywords', 'array-contains', topic.toLowerCase()).get();

                if (snapshot.empty) {
                    responseMessage = `Sorry, I don't have information about ${topic} yet.`;
                } else {
                    const doc = snapshot.docs[0];
                    responseMessage = doc.data().response_text;
                }
            }
        }
        // NEW LOGIC FOR VACCINATION SUBSCRIPTION
        else if (intentName === 'subscribe_vaccination_reminder') {
            const childDob = result.parameters.fields['child-dob'].stringValue;
            if (childDob) {
                const remindersCollection = db.collection('reminders');
                await remindersCollection.doc(userPhoneNumber).set({
                    child_dob: new Date(childDob),
                    subscribed_on: new Date()
                });
                responseMessage = "Thank you! You are now subscribed to vaccination reminders.";
            }
        }

        // Send the final response to the user via Twilio
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(responseMessage);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());

    } catch (error) {
        console.error('ERROR:', error);
        // Generic error message
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("Sorry, I'm having trouble right now. Please try again later.");
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
    }
};