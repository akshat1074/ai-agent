const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.post('/api/generate-cleaning-script', async (req, res) => {
  try {
    const { data_sample, issues, validation_feedback } = req.body;

    const prompt = `You are Cline, an expert coding assistant. Generate a complete JavaScript function to clean this data.

Data Sample:
${JSON.stringify(data_sample.slice(0, 3), null, 2)}

Issues Detected:
${issues.map(i => `- ${i.type}: ${i.description}`).join('\n')}

${validation_feedback ? `\nValidation Feedback from Oumi:\n${validation_feedback}` : ''}

Generate a JavaScript function called cleanData(data, headers) that:
1. Takes an array of data objects and headers array
2. Removes duplicates
3. Fills missing values
4. Standardizes formats
5. Returns cleaned data array

Return ONLY the function code, no explanations.`;

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const code = response.data.content[0].text;

    res.json({
      success: true,
      code: code.replace(/```javascript|```js|```/g, '').trim(),
      agent: 'Cline (Claude Sonnet 4)'
    });

  } catch (error) {
    console.error('Cline error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🤖 Cline service running on port ${PORT}`);
});