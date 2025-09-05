# FoodLog API

Vercel serverless function for food analysis using Google Gemini AI.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file with your Gemini API key:
```bash
GEMINI_API_KEY=your_api_key_here
```

3. Deploy to Vercel:
```bash
vercel --prod
```

## API Endpoint

`POST /api/food-analyze`

### Request Body:
```json
{
  "imageBase64": "base64_encoded_image_string (optional)",
  "description": "food description (optional)",
  "language": "ko" or "en",
  "userProfile": {
    "age": 30,
    "gender": "male",
    "dailyCalorieGoal": 2000,
    "dailyCarbGoal": 300,
    "dailyProteinGoal": 60,
    "dailyFatGoal": 65
  }
}
```

### Response:
```json
{
  "foodName": "김치찌개",
  "calories": 250,
  "carbs": 15.5,
  "protein": 18.2,
  "fat": 12.3,
  "sugar": 3.5,
  "sodium": 850,
  "fiber": 2.8,
  "description": "매콤한 한국 전통 찌개",
  "servingSize": 1.0,
  "ingredients": ["김치", "돼지고기", "두부"],
  "nutritions": ["단백질이 풍부합니다", "나트륨 함량이 높습니다"]
}
```