const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Oumi endpoint (using OpenRouter as Oumi proxy for open models)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

app.post('/api/validate-approach', async (req, res) => {
  try {
    const { cleaning_plan, data_summary } = req.body;

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.1-8b-instruct:free', // Free open-source model
        messages: [
          {
            role: 'system',
            content: 'You are a data quality expert. Review data cleaning plans and suggest improvements.'
          },
          {
            role: 'user',
            content: `Data Summary: ${data_summary}\n\nProposed Cleaning Plan: ${cleaning_plan}\n\nValidate this approach and suggest improvements. Be concise.`
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const validation = response.data.choices[0].message.content;

    res.json({
      success: true,
      validation: validation,
      model_used: 'LLaMA 3.1 8B (Open Source)'
    });

  } catch (error) {
    console.error('Oumi error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/generate-code', async (req, res) => {
  try {
    const { data_sample, issues } = req.body;

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        messages: [
          {
            role: 'system',
            content: 'You are a Python expert. Generate pandas code to clean data. Return ONLY code, no explanations.'
          },
          {
            role: 'user',
            content: `Data Sample:\n${JSON.stringify(data_sample)}\n\nIssues: ${issues}\n\nGenerate Python pandas code to fix these issues.`
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const code = response.data.choices[0].message.content;

    res.json({
      success: true,
      code: code.replace(/```python|```/g, '').trim(),
      model_used: 'LLaMA 3.1 8B (Open Source)'
    });

  } catch (error) {
    console.error('Oumi error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`🤖 Oumi service running on port ${PORT}`);
});