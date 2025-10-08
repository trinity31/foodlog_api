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

    // 사용자 프로필 기반 가이드 생성 함수
    const generateUserProfileGuide = (userProfile, isKorean) => {
      if (!userProfile) return '';

      const guides = [];

      // 영양 목표 기반 가이드
      if (userProfile.dailyCalorieGoal) {
        guides.push(isKorean
          ? `사용자의 일일 목표 칼로리는 ${userProfile.dailyCalorieGoal}kcal입니다.`
          : `User's daily calorie goal is ${userProfile.dailyCalorieGoal}kcal.`
        );
      }

      if (userProfile.dailyCarbGoal || userProfile.dailyProteinGoal || userProfile.dailyFatGoal) {
        guides.push(isKorean
          ? `사용자의 일일 영양소 목표: 탄수화물 ${userProfile.dailyCarbGoal}g, 단백질 ${userProfile.dailyProteinGoal}g, 지방 ${userProfile.dailyFatGoal}g`
          : `User's daily nutrition goals: Carbs ${userProfile.dailyCarbGoal}g, Protein ${userProfile.dailyProteinGoal}g, Fat ${userProfile.dailyFatGoal}g`
        );
      }

      // 건강 관심사 번역 맵
      const healthInterestTranslations = {
        'weightLoss': { korean: '체중 감량', english: 'Weight Loss' },
        'muscleGain': { korean: '근육 증가', english: 'Muscle Gain' },
        'sugarControl': { korean: '혈당 관리', english: 'Blood Sugar Control' },
        'slowAging': { korean: '저속노화', english: 'Anti-Aging' },
        'heartHealth': { korean: '심장 건강', english: 'Heart Health' },
        'immunity': { korean: '면역력 강화', english: 'Immunity Boost' },
        'sleep': { korean: '수면 개선', english: 'Sleep Improvement' },
        'stress': { korean: '스트레스 관리', english: 'Stress Management' },
        'eyeHealth': { korean: '눈 건강', english: 'Eye Health' },
        'other': { korean: '기타', english: 'Other' }
      };

      // 건강 관심사 기반 가이드
      if (userProfile.healthInterests && userProfile.healthInterests.length > 0) {
        const translatedInterests = userProfile.healthInterests.map(interest => {
          const translation = healthInterestTranslations[interest];
          return isKorean ? (translation?.korean || interest) : (translation?.english || interest);
        });

        guides.push(isKorean
          ? `사용자의 건강 관심사: ${translatedInterests.join(', ')}`
          : `User's health interests: ${translatedInterests.join(', ')}`
        );
      }

      // 식이 제한 기반 가이드
      if (userProfile.dietaryRestrictions && userProfile.dietaryRestrictions.length > 0) {
        guides.push(isKorean
          ? `사용자의 식이 제한: ${userProfile.dietaryRestrictions.join(', ')}`
          : `User's dietary restrictions: ${userProfile.dietaryRestrictions.join(', ')}`
        );
      }

      if (guides.length > 0) {
        const guideTitle = isKorean ? '사용자 맞춤 분석 가이드' : 'User-specific Analysis Guide';
        const analysisNote = isKorean
          ? '위 정보를 고려하여 분석 및 추천을 진행해주세요.'
          : 'Please proceed with analysis and recommendations considering the above information.';

        return `${guideTitle}:\n${guides.join('\n')}\n${analysisNote}`;
      }

      return '';
    };

    const isKorean = language === 'ko';
    const userGuide = generateUserProfileGuide(userProfile, isKorean);

    // 프롬프트 생성
    let prompt = `You are a professional nutritionist. Analyze this food and provide nutritional information.
    ${description ? `Food description: ${description}` : ''}

    ${userGuide}

    Please provide a response in ${isKorean ? 'Korean' : 'English'} with the following JSON format:
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
        "analysis": "Brief health analysis of this food only (focus on food characteristics, not daily goals comparison)"
      },
      "recommendations": {
        "healthImprovements": "Specific improvement suggestions",
        "alternativeOptions": "Healthier alternative food suggestions"
      }
    }

    IMPORTANT:
    - For "nutritions" field, provide ONLY specific nutrient names (like vitamins, minerals) as an array of strings. Do NOT include sentences or descriptions. Examples: ["비타민C", "칼슘", "철분", "식이섬유"] or ["Vitamin C", "Calcium", "Iron", "Fiber"].
    - For "analysis" field, analyze ONLY the food characteristics itself. Do NOT compare with daily nutritional goals or mention "daily target" or "일일 목표". Focus on the food's nutritional quality, ingredients, and health benefits/concerns.

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