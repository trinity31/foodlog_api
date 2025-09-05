# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요
FoodLog API - Google Gemini AI를 사용한 음식 영양 분석 Vercel serverless function

## 개발 명령어

### 로컬 개발 서버 실행
```bash
npm run dev
```
Vercel 개발 서버를 실행하여 로컬에서 API 테스트 가능 (localhost:3000)

### 프로덕션 배포
```bash
npm run deploy
```
Vercel 프로덕션 환경으로 배포

### 의존성 설치
```bash
npm install
```

## 아키텍처

### 핵심 구조
- **Vercel Serverless Function**: `/api/food-analyze.js`가 단일 엔드포인트로 작동
- **AI 모델**: Google Gemini 1.5 Flash 모델 사용 (빠른 응답 속도)
- **CORS 설정**: `vercel.json`에서 모든 도메인 허용 설정

### API 엔드포인트
**POST /api/food-analyze**
- 이미지 기반 또는 텍스트 설명 기반 음식 분석
- Base64 인코딩된 이미지와 사용자 프로필 정보 처리
- 한국어/영어 응답 지원
- JSON 형식의 영양 정보 반환 (칼로리, 탄수화물, 단백질, 지방 등)

### 주요 파일
- `/api/food-analyze.js`: 메인 API 핸들러 - Gemini AI 통합 및 음식 분석 로직
- `vercel.json`: Vercel 배포 설정 - 함수 타임아웃(30초), CORS 헤더
- `.env.example`: 환경 변수 템플릿 (GEMINI_API_KEY 필요)

### 환경 변수
- `GEMINI_API_KEY`: Google AI Studio에서 발급받은 Gemini API 키 필요
- Vercel 대시보드 또는 `.env` 파일에 설정

### 데이터 처리 흐름
1. 클라이언트가 이미지(Base64) 또는 텍스트 설명 전송
2. Gemini AI 모델에 프롬프트와 함께 분석 요청
3. AI 응답에서 JSON 추출 및 검증
4. 구조화된 영양 정보 반환

### 에러 처리
- 입력 검증: 이미지 또는 설명 필수
- JSON 파싱 실패 시 에러 메시지 반환
- 모든 숫자 필드에 기본값 설정으로 안정성 확보