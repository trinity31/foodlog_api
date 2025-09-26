const { GoogleGenerativeAI } = require('@google/generative-ai');

// Gemini API 초기화
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

module.exports = async (req, res) => {
  // CORS 처리
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageBase64, description, language = 'ko', userProfile } = req.body;

    if (!imageBase64 && !description) {
      return res.status(400).json({ error: '이미지 또는 설명이 필요합니다.' });
    }

    // Gemini Pro Vision 모델 사용
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    // 프롬프트 생성
    let prompt = `You are a professional nutritionist. Analyze this food and provide nutritional information.
    ${description ? `Food description: ${description}` : ''}
    
    ${userProfile ? `User Profile:
    - Age: ${userProfile.age}
    - Gender: ${userProfile.gender}
    - Daily Calorie Goal: ${userProfile.dailyCalorieGoal}
    - Daily Carb Goal: ${userProfile.dailyCarbGoal}g
    - Daily Protein Goal: ${userProfile.dailyProteinGoal}g
    - Daily Fat Goal: ${userProfile.dailyFatGoal}g` : ''}
    
    Please provide a response in ${language === 'ko' ? 'Korean' : 'English'} with the following JSON format:
    {
      "foodName": "Name of the food",
      "calories": number (kcal),
      "carbs": number (grams),
      "protein": number (grams),
      "fat": number (grams),
      "sugar": number (grams),
      "sodium": number (mg),
      "fiber": number (grams),
      "description": "Brief description of the food",
      "servingSize": number (1 serving = 1.0),
      "ingredients": ["ingredient1", "ingredient2"],
      "nutritions": ["비타민C", "단백질", "탄수화물"],
      "analysis": {
        "healthScore": number (0-100),
        "analysis": "Brief health analysis considering user profile"
      },
      "recommendations": {
        "healthImprovements": "Specific improvement suggestions",
        "alternativeOptions": "Healthier alternative food suggestions"
      }
    }

    IMPORTANT: For "nutritions" field, provide ONLY specific nutrient names (like vitamins, minerals) as an array of strings. Do NOT include sentences or descriptions. Examples: ["비타민C", "칼슘", "철분", "식이섬유"] or ["Vitamin C", "Calcium", "Iron", "Fiber"].

    Provide realistic estimates based on typical portions and recipes.`;

    let result;
    
    if (imageBase64) {
      // 이미지가 있는 경우
      const imageParts = [
        {
          inlineData: {
            data: imageBase64,
            mimeType: 'image/jpeg'
          }
        }
      ];
      
      const response = await model.generateContent([prompt, ...imageParts]);
      result = response.response;
    } else {
      // 텍스트만 있는 경우
      const response = await model.generateContent(prompt);
      result = response.response;
    }

    const text = result.text();
    
    // JSON 파싱 시도
    let jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[0];
      const data = JSON.parse(jsonStr);
      
      // 데이터 검증 및 기본값 설정
      const validatedData = {
        foodName: data.foodName || '미확인 음식',
        calories: parseInt(data.calories) || 0,
        carbs: parseFloat(data.carbs) || 0,
        protein: parseFloat(data.protein) || 0,
        fat: parseFloat(data.fat) || 0,
        sugar: parseFloat(data.sugar) || 0,
        sodium: parseFloat(data.sodium) || 0,
        fiber: parseFloat(data.fiber) || 0,
        description: data.description || '',
        servingSize: parseFloat(data.servingSize) || 1.0,
        ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
        nutritions: Array.isArray(data.nutritions) ? data.nutritions : [],
        analysis: data.analysis ? {
          healthScore: parseInt(data.analysis.healthScore) || 50,
          analysis: data.analysis.analysis || ''
        } : undefined,
        recommendations: data.recommendations ? {
          healthImprovements: data.recommendations.healthImprovements || '',
          alternativeOptions: data.recommendations.alternativeOptions || ''
        } : undefined
      };
      
      return res.status(200).json(validatedData);
    } else {
      throw new Error('응답에서 JSON을 추출할 수 없습니다.');
    }

  } catch (error) {
    console.error('Error analyzing food:', error);
    return res.status(500).json({ 
      error: 'Food analysis failed', 
      details: error.message 
    });
  }
};