require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const mockPPG = require('./mockPPGService')();

const USE_MOCK_PPG = String(process.env.USE_MOCK_PPG).trim().toLowerCase() === 'true';
console.log('🔍 USE_MOCK_PPG from .env:', process.env.USE_MOCK_PPG);
console.log('🔍 Parsed USE_MOCK_PPG:', USE_MOCK_PPG, typeof USE_MOCK_PPG);

const PPG_SERVICE_URL = process.env.PPG_SERVICE_URL || 'http://localhost:8080';

const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY;
const AZURE_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com';
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION || 'global';

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || 'eastus';

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json());

// ------------------ Azure Translator ------------------
async function translateText(text, fromLang, toLang) {
  const response = await axios({
    baseURL: AZURE_ENDPOINT,
    url: '/translate',
    method: 'post',
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_KEY,
      'Ocp-Apim-Subscription-Region': AZURE_REGION,
      'Content-type': 'application/json',
      'X-ClientTraceId': require('crypto').randomUUID()
    },
    params: {
      'api-version': '3.0',
      'from': fromLang,
      'to': toLang
    },
    data: [{ 'text': text }],
    responseType: 'json'
  });
  return response.data[0].translations[0].text;
}

// ------------------ Azure Speech-to-Text ------------------
async function speechToText(audioBuffer, language = 'zu-ZA') {
  const response = await axios({
    method: 'post',
    url: `https://${AZURE_SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`,
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
      'Content-Type': 'audio/wav',
      'Accept': 'application/json'
    },
    params: {
      'language': language,
      'format': 'detailed'
    },
    data: audioBuffer
  });
  return response.data.DisplayText || response.data.RecognitionStatus;
}

// ------------------ Azure Text-to-Speech ------------------
async function textToSpeech(text, language = 'zu-ZA', voice = 'zu-ZA-ThandoNeural') {
  const ssml = `
    <speak version='1.0' xml:lang='${language}'>
      <voice xml:lang='${language}' name='${voice}'>
        ${text}
      </voice>
    </speak>
  `;
  const response = await axios({
    method: 'post',
    url: `https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
    },
    data: ssml,
    responseType: 'arraybuffer'
  });
  return response.data;
}

// ------------------ Health Query Processor ------------------
async function processHealthQuery(englishQuery, userId = 'demo-user') {
  const query = englishQuery.toLowerCase();

  // Heart Rate
  if (query.includes('heart rate') || query.includes('pulse') || query.includes('measure heart')) {
    console.log('🫀 Triggering heart rate measurement...');

    let heartRateData;
    if (USE_MOCK_PPG) {
      console.log('⚙️ Using mockPPG service...');
      heartRateData = await mockPPG.measureHeartRate(userId);
    } else {
      console.log('🌐 Calling real PPG service...');
      const response = await axios.post(`${PPG_SERVICE_URL}/api/ppg/heartrate`, {
        userId,
        triggeredBy: 'voice'
      });
      heartRateData = response.data;
    }

    if (heartRateData && heartRateData.heartRate) {
      return `Your heart rate is ${heartRateData.heartRate} beats per minute. This appears to be within normal range.`;
    } else {
      return 'Please place your finger on the camera to measure your heart rate.';
    }
  }

  // Oxygen Level
  if (query.includes('blood oxygen') || query.includes('oxygen') || query.includes('spo2')) {
    console.log('🩸 Triggering blood oxygen measurement...');

    let oxygenData;
    if (USE_MOCK_PPG) {
      console.log('⚙️ Using mockPPG service...');
      oxygenData = await mockPPG.measureOxygen(userId);
    } else {
      console.log('🌐 Calling real PPG service...');
      const response = await axios.post(`${PPG_SERVICE_URL}/api/ppg/oxygen`, {
        userId,
        triggeredBy: 'voice'
      });
      oxygenData = response.data;
    }

    if (oxygenData && oxygenData.oxygenLevel) {
      return `Your blood oxygen level is ${oxygenData.oxygenLevel} percent. This is ${oxygenData.oxygenLevel >= 95 ? 'normal' : 'below normal range'}.`;
    } else {
      return 'Please place your finger on the camera to measure your blood oxygen level.';
    }
  }

  // Trends / History
  if (query.includes('trends') || query.includes('history') || query.includes('previous')) {
    console.log('📊 Fetching health trends...');

    let trendsData;
    if (USE_MOCK_PPG) {
      console.log('⚙️ Using mockPPG service...');
      const mockData = await mockPPG.getHealthTrends(userId);
      const latest = mockData.trends[mockData.trends.length - 1];
      return `Your recent average heart rate is ${latest.avgHeartRate} BPM. Your readings have been ${latest.trend} over the past week.`;
    } else {
      console.log('🌐 Calling real PPG service...');
      const response = await axios.get(`${PPG_SERVICE_URL}/api/health/trends?userId=${userId}`);
      const data = response.data;
      if (data && data.length > 0) {
        const latest = data[data.length - 1];
        return `Your recent average heart rate is ${latest.avgHeartRate} BPM. Your readings have been ${latest.trend || 'stable'} over the past week.`;
      } else {
        return 'No previous measurements found. Take your first measurement using the camera feature.';
      }
    }
  }

  return 'I can help you monitor your health using your phone camera. Try asking me to measure your heart rate, check your blood oxygen, or show your health trends.';
}

// ------------------ Endpoints ------------------
app.post('/process-health-query', async (req, res) => {
  try {
    const { query, userLanguage = 'zu', userId = 'demo-user' } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    console.log(`🎤 Received query: "${query}" in language: ${userLanguage}`);

    let englishQuery = query;
    if (userLanguage !== 'en') {
      englishQuery = await translateText(query, userLanguage, 'en');
      console.log(`🔄 Translated to English: "${englishQuery}"`);
    }

    const englishResponse = await processHealthQuery(englishQuery, userId);
    console.log(`🏥 Health response: "${englishResponse}"`);

    let finalResponse = englishResponse;
    if (userLanguage !== 'en') {
      finalResponse = await translateText(englishResponse, 'en', userLanguage);
      console.log(`🔄 Translated back to ${userLanguage}: "${finalResponse}"`);
    }

    res.json({
      originalQuery: query,
      englishQuery,
      englishResponse,
      translatedResponse: finalResponse,
      language: userLanguage,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Processing error:', error.message);
    res.status(500).json({ error: 'Query processing failed', details: error.message });
  }
});

// ------------------ Start Server ------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('🚀 isiZulu Health Voice Assistant Backend Started');
  console.log('🔗 Using Azure Translator + Speech Services');
  console.log(`🔌 PPG Service URL: ${PPG_SERVICE_URL}`);
});
