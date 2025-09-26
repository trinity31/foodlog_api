// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// deno-lint-ignore-file no-explicit-any

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// Deno 타입 정의
// @ts-ignore: Deno 환경을 위한 타입
declare const Deno: any;

// @ts-ignore: Supabase Functions 개발 환경 타입 오류 무시
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore: Supabase Functions 개발 환경 타입 오류 무시
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Google AI SDK 임포트
// @ts-ignore: Supabase Functions 개발 환경 타입 오류 무시
import { GoogleGenAI, Type } from 'https://esm.sh/@google/genai';

// 환경 변수에서 API 키를 가져옵니다
const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// GoogleGenAI 클라이언트 초기화
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

// Supabase 클라이언트 초기화
const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

console.log("Gemini Flash Analysis Function Initialized");

// 전역 에러 핸들러 추가
globalThis.addEventListener("error", (e) => {
  console.error("전역 에러:", e.error);
});

globalThis.addEventListener("unhandledrejection", (e) => {
  console.error("처리되지 않은 Promise 거부:", e.reason);
});

// 메모리 사용량 모니터링
console.log("초기 메모리:", Deno.memoryUsage());

// 재시도 설정
const MAX_RETRIES = 3;  // 최대 재시도 횟수
const RETRY_DELAY_MS = 1000;  // 재시도 간격 (밀리초)

// 모델 정의
const MODELS = {
  PRIMARY: 'gemini-2.0-flash',
  FALLBACK: 'gemini-1.5-flash',  // 폴백(대체) 모델
  FALLBACK_PRO: 'gemini-1.5-pro',  // 2차 폴백 모델
};

// sleep 유틸리티 함수
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Gemini 구조화된 출력을 위한 타입 정의
type FoodAnalysisResult = {
  foodName: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  // 추가: 당류(자유/첨가당) 및 나트륨(소금)
  sugar?: number; // 당류(자유/첨가당, g)
  sodium?: number; // 나트륨(소금, mg)
  fiber?: number; // 식이섬유 (g)
  description: string;
  // 추가 정보
  ingredients?: string[];
  nutritions?: string[];
  analysis?: {
    healthScore: number;  // 0-100 점수
    analysis: string;     // 종합 분석
  };
  recommendations?: {
    healthImprovements: string;
    alternativeOptions: string;
  };
};

// 언어별 프롬프트 문장들
const PROMPT_COMMON = {
  KOREAN: {
    FOOD_DETAIL: '\'한국 음식\'이라면 구체적인 한국 음식 이름으로 응답해주세요. 예를 들어 \'김치찌개\', \'불고기\', \'비빔밥\' 등으로 응답해 주세요.',
    // PER_SERVING: '중요: 사진에 보이는 음식이 몇인분인지를 나타내는 숫자(ex. 1인분, 2인분, 3인분)를 반드시 포함해주세요.',
    NUTRITION_GUIDE: `영양소 분석 기준:
    - 주요 영양소를 분석하여 포함된 영양소를 나열해주세요.
    - 예시: 비타민A, 비타민C, 칼슘, 철분, 식이섬유, 오메가3 등
    - 해당 음식에서 특별히 풍부한 영양소를 반드시 포함해주세요.
    - 추가: 음식에 포함된 당류 계산 시 중요한 점: 
      * 사과, 바나나, 포도 등 과일에 있는 자연당은 제외하고 오직 가공식품에 추가된 첨가당/자유당만 계산해야 합니다.
      * 사과, 바나나 등 순수한 과일은 첫가당이 0g입니다.
      * 음료, 과자, 양념, 소스 등에 포함된 첫가당만 계산해주세요.
      * 나트륨(소금, mg)과 식이섬유(g) 함량도 추정해 알려주세요.
      * 만약 추정이 어렵다면 0으로 표시하세요.`,
  },
  ENGLISH: {
    FOOD_DETAIL: 'Please provide specific and accurate food names. For example, \'Grilled Chicken Salad\', \'Beef Stir-fry\', \'Vegetable Soup\', etc.',
    // PER_SERVING: 'Important: Please include the number indicating how many servings the food in the photo represents (e.g., 1 serving, 2 servings, 3 servings).',
    NUTRITION_GUIDE: `Nutrition analysis criteria:
    - Analyze and list the main nutrients included.
    - Examples: Vitamin A, Vitamin C, Calcium, Iron, Dietary Fiber, Omega-3, etc.
    - Please include nutrients that are particularly abundant in the food.
    - Important note on calculating sugar content in food: 
      * Exclude natural sugars in fruits like apples, bananas, grapes, and only calculate added/free sugars in processed foods.
      * Pure fruits like apples and bananas have 0g added sugar.
      * Only calculate added sugars in beverages, snacks, seasonings, sauces, etc.
      * Please also estimate and provide sodium (salt, mg) and dietary fiber (g) content.
      * If estimation is difficult, mark as 0.`,
  }
};

// 사용자 프로필 기반 분석 가이드 생성 함수
function generateUserProfileGuide(userProfile: any, isKorean: boolean = true): string {
  if (!userProfile) return '';

  const guides: string[] = [];

  // 영양 목표 기반 가이드
  if (userProfile.dailyCalorieGoal) {
    if (isKorean) {
      guides.push(`사용자의 일일 목표 칼로리는 ${userProfile.dailyCalorieGoal}kcal입니다.`);
    } else {
      guides.push(`User's daily calorie goal is ${userProfile.dailyCalorieGoal}kcal.`);
    }
  }
  if (userProfile.dailyCarbGoal || userProfile.dailyProteinGoal || userProfile.dailyFatGoal) {
    if (isKorean) {
      guides.push(`사용자의 일일 영양소 목표: 탄수화물 ${userProfile.dailyCarbGoal}g, 단백질 ${userProfile.dailyProteinGoal}g, 지방 ${userProfile.dailyFatGoal}g`);
    } else {
      guides.push(`User's daily nutrition goals: Carbs ${userProfile.dailyCarbGoal}g, Protein ${userProfile.dailyProteinGoal}g, Fat ${userProfile.dailyFatGoal}g`);
    }
  }

  // 건강 관심사 변환 맵
  const healthInterestTranslations: Record<string, { korean: string; english: string }> = {
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
  if (userProfile.healthInterests?.length > 0) {
    const translatedHealthInterests = userProfile.healthInterests.map((interest: string) => {
      const translation = healthInterestTranslations[interest];
      return isKorean ? (translation?.korean || interest) : (translation?.english || interest);
    });
    
    if (isKorean) {
      guides.push(`사용자의 건강 관심사: ${translatedHealthInterests.join(', ')}`);
    } else {
      guides.push(`User's health interests: ${translatedHealthInterests.join(', ')}`);
    }
  }

  // 식이 제한 기반 가이드
  if (userProfile.dietaryRestrictions?.length > 0) {
    if (isKorean) {
      guides.push(`사용자의 식이 제한: ${userProfile.dietaryRestrictions.join(', ')}`);
    } else {
      guides.push(`User's dietary restrictions: ${userProfile.dietaryRestrictions.join(', ')}`);
    }
  }

  console.log("userProfile.healthInterests", userProfile.healthInterests);

  // 건강 관심사에 따른 참고자료 링크 매핑
  const healthInterestLinks: Record<string, string> = {
    'eyeHealth': 'https://www.nei.nih.gov/learn-about-eye-health/healthy-vision/keep-your-eyes-healthy',
    'heartHealth': 'https://www.heart.org/en/healthy-living/healthy-eating/heart-check-foods',
    'muscleGain': 'https://www.nsca.com/education/articles/kinetic-select/high-protein-diets/',
    'immunity': 'https://www.healthline.com/health/food-nutrition/foods-that-boost-the-immune-system',
    'weightLoss': 'https://www.cdc.gov/healthy-weight-growth/healthy-eating/index.html',
    'sugarControl': 'https://www.healthline.com/nutrition/foods-to-lower-blood-sugar',
    'slowAging': 'https://kormedi.com/1707012/',
    'sleep': 'https://www.hopkinsmedicine.org/health/wellness-and-prevention/better-sleep-3-simple-diet-tweaks',
    'stress': 'https://www.nimh.nih.gov/health/publications/stress',
  };

  // 참고자료 링크 목록 생성
  let referenceLinks = '';
  if (userProfile.healthInterests?.length > 0) {
    const links: string[] = [];
    
    // 사용자 건강 관심사에 맞는 링크 추가
    userProfile.healthInterests.forEach((interest: string) => {
      if (healthInterestLinks[interest]) {
        const translation = healthInterestTranslations[interest];
        const interestName = isKorean ? (translation?.korean || interest) : (translation?.english || interest);
        const linkText = isKorean ? '관련 참고자료' : 'Related Reference';
        links.push(`${interestName} ${linkText}: ${healthInterestLinks[interest]}`);
      }
    });
    
    // 사용자 맞춤 건강 관심사가 있을 경우
    if (userProfile.customHealthInterest && userProfile.customHealthInterest.trim() !== '') {
      const linkText = isKorean ? '관련 참고자료' : 'Related Reference';
      links.push(`${userProfile.customHealthInterest} ${linkText}: https://www.nutrition.gov/topics/basic-nutrition`);
    }
    
    // 링크가 있을 경우에만 참고자료 섹션 추가
    if (links.length > 0) {
      const referencesTitle = isKorean ? '참고자료' : 'References';
      referenceLinks = `${referencesTitle}:\n${links.join('\n')}`;
    }
  }

  // 가이드 조합 (참고자료 링크 포함)
  if (guides.length > 0) {
    const guideTitle = isKorean ? '사용자 맞춤 분석 가이드' : 'User-specific Analysis Guide';
    const analysisNote = isKorean ? '위 정보를 고려하여 분석 및 추천을 진행해주세요.' : 'Please proceed with analysis and recommendations considering the above information.';
    
    return `${guideTitle}:\n${guides.join('\n')}\n${analysisNote}
    ${referenceLinks ? referenceLinks : ''}`;
  }
  
  return '';
}

// Gemini API 호출 함수 (재시도 로직 포함)
async function callGeminiWithRetry(contentParts: any[], promptText: string, corsHeaders: any) {
  // 모델 시퀀스 정의 (우선순위 순)
  const modelSequence = [MODELS.PRIMARY, MODELS.FALLBACK, MODELS.FALLBACK_PRO];
  
  // 응답 스키마 정의
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      foodName: { type: Type.STRING, description: '음식의 짧은 이름 (ex. 두부강정 라이스볼)', nullable: false },
      calories: { type: Type.NUMBER, description: ' 칼로리 (kcal)', nullable: false },
      carbs: { type: Type.NUMBER, description: ' 탄수화물 (g)', nullable: false },
      protein: { type: Type.NUMBER, description: '단백질 (g)', nullable: false },
      fat: { type: Type.NUMBER, description: ' 지방 (g)', nullable: false },
      // 추가: 당류(자유/첨가당, g)와 나트륨(소금, mg)
      sugar: { 
        type: Type.NUMBER, 
        description: '가공식품에 첨가된 첫가당/자유당만 계산(g). 중요: 사과, 바나나, 포도 등 순수 과일의 자연당은 제외하고 반드시 0으로 처리해야 함. 오직 음료, 과자, 양념, 소스 등에 첨가된 당류만 계산.', 
        nullable: true 
      },
      sodium: { type: Type.NUMBER, description: '나트륨(소금, mg)', nullable: true },
      fiber: { type: Type.NUMBER, description: '식이섬유 (g)', nullable: true },
      servingSize: { type: Type.NUMBER, description: ' 몇인분인지를 나타내는 숫자(ex. 1인분, 2인분, 3인분)', nullable: false },
      description: { type: Type.STRING, description: '음식 설명으로 반드시 1개의 짧은 문장(예: 30자 이내). 두 문장 이상, 쉼표로 이어붙인 복합문, 장황한 설명과 몇인분인지 절대 포함하지 마세요. (ex. 브로콜리와 두부강정이 들어간 곡물 볼)', nullable: false },
      // 추가 정보
      ingredients: { type: Type.ARRAY, items: { type: Type.STRING }, description: '주요 재료 목록', nullable: true },
      nutritions: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING }, 
        description: '주요 영양소 목록 (예: 비타민A, 비타민C, 칼슘, 철분, 식이섬유, 오메가3 등). 해당 음식에서 특별히 풍부한 영양소를 포함해야 합니다.', 
        nullable: true 
      },
      analysis: {
        type: Type.OBJECT,
        description: '음식 분석',
        properties: {
          healthScore: { 
            type: Type.NUMBER, 
            description: '사용자의 건강 관심사와 식이제한을 고려한 건강 점수 (0-100)', 
            nullable: false 
          },
          analysis: { 
            type: Type.STRING, 
            description: '사용자의 칼로리 목표, 건강 관심사, 식이제한 등을 고려한 종합 분석을 간략하게 설명하세요. (50단어 이내)', 
            nullable: false 
          }
        },
        nullable: true
      },
      recommendations: {
        type: Type.OBJECT,
        description: '추천 사항',
        properties: {
          healthImprovements: { 
            type: Type.STRING, 
            description: '분석 결과에 기반한 구체적인 개선점 (예: 나트륨이 높으니 소스를 반으로 줄이세요, 단백질이 부족하니 계란을 추가하세요 등)', 
            nullable: true 
          },
          alternativeOptions: { 
            type: Type.STRING, 
            description: '사용자의 건강 관심사와 식이제한을 고려한 건강한 대체 음식 추천 (예: 흰 쌀밥 대신 현미밥, 라면 대신 곤드레밥 등)', 
            nullable: true 
          }
        },
        nullable: true
      }
    },
    required: ['foodName', 'calories', 'carbs', 'protein', 'fat', 'description']
  };

  // 각 모델에 대해 재시도 로직 실행
  for (const model of modelSequence) {
    let retryCount = 0;
    
    while (retryCount < MAX_RETRIES) {
      try {
        console.log(`${model} 모델 사용 시도 중... (시도 ${retryCount + 1}/${MAX_RETRIES})`);
        
        // Gemini API 호출 (구조화된 출력 사용)
        const response = await ai.models.generateContent({
          model: model,
          contents: contentParts.concat({ text: promptText }),
          config: {
            temperature: 0.1,
            topK: 32,
            topP: 0.95,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: responseSchema
          }
        });
        
        const responseText = response.text;
        console.log(`${model} 모델 응답 성공:`, responseText);

              
        // JSON 파싱
        try {
          const foodData = JSON.parse(responseText);
          console.log("JSON 파싱 성공:", Object.keys(foodData).length, "필드 추출됨");
          return { success: true, data: foodData };
        } catch (parseError) {
          console.error('JSON 파싱 실패:', parseError);
          // JSON 파싱 실패 시 다음 재시도로 넘어감
          throw new Error('JSON 파싱 실패');
        }
      } catch (error) {
        console.error(`${model} 모델 호출 오류 (시도 ${retryCount + 1}/${MAX_RETRIES}):`, error);
        
        // 서버 과부하 오류일 경우 (503)
        if (error.message?.includes('503') || error.message?.includes('overloaded')) {
          console.log(`서버 과부하 감지, ${RETRY_DELAY_MS}ms 후 재시도...`);
          await sleep(RETRY_DELAY_MS);
          retryCount++;
          continue;
        }
        
        // 그 외 오류의 경우 다음 모델로 이동
        break;
      }
    }
    
    console.log(`${model} 모델 시도 실패, 다음 모델로 전환...`);
  }
  
  // 모든 모델 시도 실패
  console.error('모든 모델 시도 실패');
  return {
    success: false,
    error: '모든 음식 분석 모델 시도 실패',
    details: '서버 과부하 또는 기타 오류로 인해 분석을 완료할 수 없습니다.'
  };
}

// 기본 음식 데이터 생성 함수 (모든 모델 실패 시 사용)
function createFallbackFoodData(description: string, isKorean: boolean = true): FoodAnalysisResult {
  if (isKorean) {
    return {
      foodName: description || '알 수 없는 음식',
      calories: 0,
      carbs: 0,
      protein: 0,
      fat: 0,
      description: `${description || '알 수 없는 음식'} (분석 실패)`,
      analysis: {
        healthScore: 50,
        analysis: '서버 과부하로 인해 정확한 분석을 제공할 수 없습니다. 나중에 다시 시도해주세요.'
      },
      recommendations: {
        healthImprovements: '현재 서비스 과부하로 인해 추천을 제공할 수 없습니다.',
        alternativeOptions: '잠시 후 다시 시도해주세요.'
      }
    };
  } else {
    return {
      foodName: description || 'Unknown Food',
      calories: 0,
      carbs: 0,
      protein: 0,
      fat: 0,
      description: `${description || 'Unknown Food'} (Analysis Failed)`,
      analysis: {
        healthScore: 50,
        analysis: 'Unable to provide accurate analysis due to server overload. Please try again later.'
      },
      recommendations: {
        healthImprovements: 'Unable to provide recommendations due to current service overload.',
        alternativeOptions: 'Please try again in a moment.'
      }
    };
  }
}

const requestId = crypto.randomUUID();
console.log(`[${requestId}] 요청 시작: ${new Date().toISOString()}`);

Deno.serve(async (req) => {
      // 응답 시간 측정 시작
  const startTime = performance.now();
  console.log(`[${requestId}] Handler 진입: ${new Date().toISOString()}`);

  const memBefore = Deno.memoryUsage();
  console.log("시작 메모리:", {
    rss: (memBefore.rss / 1024 / 1024).toFixed(2) + "MB",
    heapTotal: (memBefore.heapTotal / 1024 / 1024).toFixed(2) + "MB",
    heapUsed: (memBefore.heapUsed / 1024 / 1024).toFixed(2) + "MB"
  });
  
  try {
    // CORS 헤더 설정
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };

    // OPTIONS 요청(preflight) 처리
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // 요청 데이터 파싱
    const { imageBase64, description, userProfile, language } = await req.json();

    // 이미지 데이터 또는 설명 중 하나는 반드시 필요
    if (!imageBase64 && !description) {
      return new Response(
        JSON.stringify({ error: '이미지 데이터 또는 음식 설명이 필요합니다' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }

    // 사용자 인증 확인 (옵션)
    const authHeader = req.headers.get('Authorization');
    let userId = 'anonymous';

    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error } = await supabaseClient.auth.getUser(token);

      if (!error && user) {
        userId = user.id;
      }
    }

    // Gemini에 전달할 콘텐츠 구성
    const contentParts: any[] = [];
    let promptText = '';
    
    // 이미지가 있으면 콘텐츠 파트에 추가
    if (imageBase64) {
      contentParts.push({
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg",
        },
      });
    }
    
    // 언어에 따른 프롬프트 선택
    const isKorean = (language || 'ko') === 'ko';
    let languagePrompt = '';
    
    if (isKorean) {
      languagePrompt = '중요: 모든 텍스트 응답(음식 이름, 설명, 분석, 추천, 개선사항, 대체옵션)은 반드시 한국어로만 작성해주세요. 절대 영어를 사용하지 마세요.';
    } else {
      languagePrompt = 'IMPORTANT: Please write ALL text responses (food name, description, analysis, recommendations, improvements, alternatives) in English ONLY. Do not use Korean.';
    }
    
    // 공통 프롬프트 문장 조합하기
    const promptCommon = isKorean ? PROMPT_COMMON.KOREAN : PROMPT_COMMON.ENGLISH;
    const commonPrompt = `${languagePrompt} ${promptCommon.FOOD_DETAIL} ${promptCommon.NUTRITION_GUIDE}`;
    const userGuide = generateUserProfileGuide(userProfile, isKorean);
    
    // 이미지와 설명이 모두 있는 경우
    if (imageBase64 && description) {
      if (isKorean) {
        promptText = `이 음식 이미지와 사용자 설명을 함께 분석하여 가장 정확한 영양 정보를 제공해주세요. 음식 이미지가 아닌 경우 "음식아님" 으로 표시하고 모든 영양정보는 0로 표시하세요. 이미지와 설명이 일치하지 않는 경우, 사용자 설명을 우선시하세요. 
        사용자 설명: "${description}"
        반드시 주요 영양소 목록(nutritions)을 분석해주세요.
        ${commonPrompt}\n\n${userGuide}`;
      } else {
        promptText = `Please analyze this food image and user description together to provide the most accurate nutritional information. If the image is not food, mark it as "not food" and set all nutritional information to 0. If the image and description don't match, prioritize the user description.
        User description: "${description}"
        Please analyze the main nutrients list (nutritions).
        ${commonPrompt}\n\n${userGuide}`;
      }
    }
    // 이미지만 있는 경우
    else if (imageBase64) {
      if (isKorean) {
        promptText = `이 음식 이미지를 분석하여 영양 정보를 제공해주세요. 반드시 주요 영양소 목록(nutritions)을 분석해주세요. ${commonPrompt}\n\n${userGuide}`;
      } else {
        promptText = `Please analyze this food image to provide nutritional information. Please analyze the main nutrients list (nutritions). ${commonPrompt}\n\n${userGuide}`;
      }
    }
    // 설명만 있는 경우
    else if (description) {
      if (isKorean) {
        promptText = `다음 음식 설명을 분석하여 영양 정보를 제공해주세요: "${description}". 반드시 주요 영양소 목록(nutritions)을 분석해주세요. ${commonPrompt}\n\n${userGuide}`;
      } else {
        promptText = `Please analyze the following food description to provide nutritional information: "${description}". Please analyze the main nutrients list (nutritions). ${commonPrompt}\n\n${userGuide}`;
      }
    }

    console.log("promptText", promptText);

    // 재시도 로직이 포함된 Gemini API 호출
    const result = await callGeminiWithRetry(contentParts, promptText, corsHeaders);
    
    // API 호출 결과 처리
    if (result.success) {
      // 성공적인 응답
      const endTime = performance.now();
      const totalDuration = endTime - startTime;
      console.log(`총 처리 시간: ${totalDuration.toFixed(2)}ms (API 호출: 시간 측정 불가)`);

      return new Response(
        JSON.stringify(result.data),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    } else {
      // 모든 모델 시도 실패
      console.error('모든 분석 시도 실패, 기본 응답 반환');
      
      // 기본 응답 생성
      const fallbackData = createFallbackFoodData(description, isKorean);
      
      return new Response(
        JSON.stringify(fallbackData),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      );
    }
  } catch (error) {
    console.error('Edge Function 오류:', error);

    return new Response(
      JSON.stringify({
        error: '음식 분석 중 오류가 발생했습니다',
        details: error.message
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } finally {
    // 이미지 처리 후
    const memAfter = Deno.memoryUsage();
    console.log("종료 메모리:", {
      rss: (memAfter.rss / 1024 / 1024).toFixed(2) + "MB",
      heapTotal: (memAfter.heapTotal / 1024 / 1024).toFixed(2) + "MB",
      heapUsed: (memAfter.heapUsed / 1024 / 1024).toFixed(2) + "MB"
    });
    
    console.log(`[${requestId}] 처리 시간: ${Date.now() - startTime}ms`);
  }
});