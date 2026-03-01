# 📊 Investment Analysis Suite

A free, open-source portfolio analysis tool with AI-powered insights.

---

## 🚀 Setup Guide (Step-by-Step)

### Step 1: Get Your Free API Keys

You need 2 API keys. Open these links and sign up:

| Service | Link | What to do |
|---------|------|------------|
| **Anthropic** | https://console.anthropic.com | Sign up → Go to "API Keys" → Create key → Copy it |
| **FMP** | https://site.financialmodelingprep.com/developer/docs | Sign up → Your API key is on the dashboard → Copy it |

⚠️ **Save both keys somewhere** - you'll need them in Step 4!

---

### Step 2: Download & Install Node.js

If you don't have Node.js installed:

1. Go to https://nodejs.org
2. Download the **LTS** version (green button)
3. Run the installer, click Next through everything

To check if it's installed, open Terminal and type:
```bash
node --version
```
You should see something like `v20.10.0`

---

### Step 3: Download This Project

**Option A: Download ZIP (Easiest)**
1. Click the green "Code" button above
2. Click "Download ZIP"
3. Extract the ZIP to your Desktop

**Option B: Using Git**
Open Terminal and run:
```bash
cd ~/Desktop
git clone https://github.com/YOUR_USERNAME/investment-dashboard.git
```

---

### Step 4: Add Your API Keys

1. Open the `backend` folder
2. Find the file called `.env` 
3. Open it with any text editor (Notepad, TextEdit, VS Code)
4. Replace the placeholder text with your actual API keys
5. Save the file

---

### Step 5: Start the Backend Server

**On Mac:**
1. Open Terminal (press Cmd+Space, type "Terminal", hit Enter)
2. Copy and paste these commands one at a time:

```bash
cd ~/Desktop/investment-dashboard-opensource/backend
```
```bash
npm install
```
```bash
npm start
```

**On Windows:**
1. Open Command Prompt (press Windows key, type "cmd", hit Enter)
2. Copy and paste these commands one at a time:

```bash
cd %USERPROFILE%\Desktop\investment-dashboard-opensource\backend
```
```bash
npm install
```
```bash
npm start
```

✅ You should see: `🚀 Server running on http://localhost:3001`

**Keep this terminal window open!**

---

### Step 6: Start the Frontend

Open a **NEW** terminal window (don't close the first one!)

**On Mac:**
```bash
cd ~/Desktop/investment-dashboard-opensource/frontend
```
```bash
npm install
```
```bash
npm start
```

**On Windows:**
```bash
cd %USERPROFILE%\Desktop\investment-dashboard-opensource\frontend
```
```bash
npm install
```
```bash
npm start
```

✅ Your browser should automatically open to `http://localhost:3000`

🎉 **You're done! The app is running!**

---

## 📖 How to Use

### Upload Your Portfolio

1. Click the **Portfolio Analyzer** tab
2. Click "Upload CSV" or drag and drop your file
3. Use this format for your CSV:

```csv
ticker,shares,avgCost
AAPL,50,150.00
VOO,100,400.00
MSFT,25,300.00
```

Or use the `sample-portfolio.csv` file included to test!

### Get AI Recommendations

1. Go to the **AI Insights** tab
2. Upload any market outlook PDF (JPMorgan, Goldman Sachs, etc.)
3. Wait for the AI to analyze and give you recommendations

---

## 🛑 Troubleshooting

### "command not found: node"
→ You need to install Node.js (see Step 2)

### "ANTHROPIC_API_KEY is missing"
→ Make sure you added your API keys to the `.env` file in the `backend` folder

### "Cannot connect to server" or "Network Error"
→ Make sure the backend is running (Step 5) - you need TWO terminal windows open

### Port already in use
→ Another app is using port 3001 or 3000. Close other apps or restart your computer

---

## 🔄 Starting the App Again Later

Every time you want to use the app:

1. Open Terminal #1 → run the backend:
```bash
cd ~/Desktop/investment-dashboard-opensource/backend && npm start
```

2. Open Terminal #2 → run the frontend:
```bash
cd ~/Desktop/investment-dashboard-opensource/frontend && npm start
```

---

## ✨ Features

- **Portfolio Analyzer** - Upload and analyze your investments
- **AI Insights** - Get AI-powered recommendations from market outlook PDFs
- **Stock Analyzer** - Deep dive into individual stocks
- **DCF Valuation** - Calculate intrinsic stock values
- **Look-Through** - See what's inside your ETFs
- **Compound Calculator** - Visualize compound growth
- **DCA Calculator** - Plan dollar-cost averaging
- **Retirement Planner** - Model retirement scenarios

---

## ⚠️ Disclaimer

This is for educational purposes only. Not financial advice. Always consult a professional before making investment decisions.

---

## 📄 License

MIT License - free to use and modify!
