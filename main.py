import logging
import os
from contextlib import asynccontextmanager
from enum import Enum
from typing import List

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("mental_health_api")

# Model path configuration
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_FILE = os.path.join(PROJECT_DIR, "Mental_Health_Model.pkl")
INDEX_FILE = os.path.join(PROJECT_DIR, "index.html")
STYLE_FILE = os.path.join(PROJECT_DIR, "style.css")
SCRIPT_FILE = os.path.join(PROJECT_DIR, "script.js")
model = None
MODEL_CATEGORIES = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager to load ML model on startup."""
    global model
    if os.path.exists(MODEL_FILE):
        try:
            logger.info(f"Loading model from {MODEL_FILE}...")
            loaded_model = joblib.load(MODEL_FILE)
            categories = get_model_categories(loaded_model)
            validate_model_categories(categories)
            model = loaded_model
            MODEL_CATEGORIES.clear()
            MODEL_CATEGORIES.update(categories)
            logger.info("Model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load model file: {e}")
            model = None
    else:
        logger.warning(f"Model file '{MODEL_FILE}' not found.")
    yield
    logger.info("Shutting down API service.")


# FastAPI app initialization
app = FastAPI(
    title="Student Mental Health Impact Prediction API",
    description=(
        "API for predicting student mental health impact scores based on "
        "social media usage, screen time, study habits, physical activity, "
        "and sleep patterns."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

local_frontend_origins = [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]
production_frontend_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
if "*" in production_frontend_origins:
    raise ValueError("CORS_ALLOWED_ORIGINS must list explicit origins, not '*'.")

# Enable CORS for the local frontend and explicitly configured production clients.
app.add_middleware(
    CORSMiddleware,
    allow_origins=local_frontend_origins + production_frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Enums for Categorical Inputs ---
class GenderEnum(str, Enum):
    male = "Male"
    female = "Female"


class AcademicLevelEnum(str, Enum):
    undergraduate = "Undergraduate"
    graduate = "Graduate"
    high_school = "High School"


class PlatformEnum(str, Enum):
    instagram = "Instagram"
    facebook = "Facebook"
    whatsapp = "WhatsApp"
    linkedin = "LinkedIn"
    snapchat = "Snapchat"
    tiktok = "TikTok"
    youtube = "YouTube"
    twitter = "Twitter"
    vkontakte = "VKontakte"
    kakaotalk = "KakaoTalk"
    line = "LINE"
    wechat = "WeChat"


class PurposeOfUseEnum(str, Enum):
    entertainment = "Entertainment"
    education = "Education"
    networking = "Networking"
    news = "News"


class StressLevelEnum(str, Enum):
    low = "Low"
    medium = "Medium"
    high = "High"
    very_high = "Very High"


def get_model_categories(loaded_model) -> dict[str, list[str]]:
    """Read categorical values from the fitted encoders in the trained pipeline."""
    categories = {}

    def collect(estimator, columns=None):
        encoded_categories = getattr(estimator, "categories_", None)
        if encoded_categories is not None and columns is not None:
            categories.update(
                {
                    str(column): [str(value) for value in values]
                    for column, values in zip(columns, encoded_categories)
                }
            )

        for _, transformer, transformer_columns in getattr(estimator, "transformers_", []):
            if isinstance(transformer_columns, str):
                input_columns = [transformer_columns]
            elif transformer_columns is None:
                input_columns = columns
            else:
                input_columns = list(transformer_columns)
                if input_columns and all(isinstance(column, int) for column in input_columns):
                    input_columns = [columns[column] for column in input_columns]
            collect(transformer, input_columns)

        for step in getattr(estimator, "named_steps", {}).values():
            collect(step, columns)

    collect(loaded_model, list(getattr(loaded_model, "feature_names_in_", [])))
    return categories


def validate_model_categories(categories: dict[str, list[str]]) -> None:
    """Fail model loading if validation enums no longer match the fitted encoders."""
    enums = {
        "Stress_Level": StressLevelEnum,
        "Gender": GenderEnum,
        "Academic_Level": AcademicLevelEnum,
        "Most_Used_Platform": PlatformEnum,
        "Purpose_Of_Use": PurposeOfUseEnum,
    }
    mismatches = {
        feature: {
            "model": sorted(categories.get(feature, [])),
            "api": sorted(value.value for value in enum_type),
        }
        for feature, enum_type in enums.items()
        if set(categories.get(feature, [])) != {value.value for value in enum_type}
    }
    if mismatches:
        raise ValueError(f"API category validation does not match model encoders: {mismatches}")


# --- Pydantic Data Schemas ---
class StudentInput(BaseModel):
    Age: int = Field(..., ge=10, le=100, description="Age of the student (years)", examples=[21])
    Gender: GenderEnum = Field(..., description="Gender identity", examples=[GenderEnum.male])
    Country: str = Field(
        default="Other",
        description="Country of residence (automatically grouped to top countries or 'Other')",
        examples=["Canada"],
    )
    Academic_Level: AcademicLevelEnum = Field(
        ..., description="Current educational stage", examples=[AcademicLevelEnum.undergraduate]
    )
    Most_Used_Platform: PlatformEnum = Field(
        ..., description="Primary social media platform used", examples=[PlatformEnum.instagram]
    )
    Purpose_Of_Use: PurposeOfUseEnum = Field(
        ..., description="Main purpose of using social media", examples=[PurposeOfUseEnum.entertainment]
    )
    Avg_Daily_Usage_Hours: float = Field(
        ..., ge=0.0, le=24.0, description="Average daily social media screen time in hours", examples=[4.6]
    )
    Daily_Unlocks: int = Field(
        ..., ge=0, le=1000, description="Average daily smartphone unlock count", examples=[166]
    )
    Study_Hours: float = Field(
        ..., ge=0.0, le=24.0, description="Average daily academic study hours", examples=[4.0]
    )
    Physical_Activity_Hours: float = Field(
        ..., ge=0.0, le=24.0, description="Average daily physical exercise / sports in hours", examples=[1.8]
    )
    Sleep_Hours_Per_Night: float = Field(
        ..., ge=0.0, le=24.0, description="Average sleep duration per night in hours", examples=[6.7]
    )
    Stress_Level: StressLevelEnum = Field(
        ..., description="Perceived academic/personal stress level", examples=[StressLevelEnum.medium]
    )

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "Age": 21,
                "Gender": "Male",
                "Country": "Canada",
                "Academic_Level": "Undergraduate",
                "Most_Used_Platform": "Instagram",
                "Purpose_Of_Use": "Entertainment",
                "Avg_Daily_Usage_Hours": 4.6,
                "Daily_Unlocks": 166,
                "Study_Hours": 4.0,
                "Physical_Activity_Hours": 1.8,
                "Sleep_Hours_Per_Night": 6.7,
                "Stress_Level": "Medium",
            }]
        }
    }


class PredictionResult(BaseModel):
    predicted_mental_health_score: float = Field(
        ..., description="Predicted Mental Health Score (scale typically 1 to 10)", examples=[7.0]
    )
    risk_category: str = Field(
        ..., description="Interpreted category based on predicted score", examples=["Good / Moderate"]
    )
    status: str = Field(default="success", examples=["success"])


class BatchPredictionRequest(BaseModel):
    students: List[StudentInput] = Field(..., description="List of student records to predict")


class BatchPredictionResponse(BaseModel):
    total: int = Field(..., examples=[1])
    predictions: List[PredictionResult]


# --- Helper Functions ---
def categorize_mental_health(score: float) -> str:
    """Categorizes the mental health score into risk tiers."""
    if score >= 7.5:
        return "Excellent / Low Risk"
    elif score >= 6.0:
        return "Good / Moderate"
    elif score >= 4.5:
        return "Fair / Mild Concern"
    else:
        return "Poor / High Risk"


def prepare_features(student: StudentInput) -> dict:
    """Formats student input into the exact feature DataFrame structure expected by the pipeline."""
    # Country grouping logic matching the trained model pipeline
    country_val = student.Country.strip()
    supported_countries = set(MODEL_CATEGORIES.get("Grouped_country", []))
    grouped_country = country_val if country_val in supported_countries else "Other"

    # Ensure non-negative physical activity matching EDA preprocessing
    physical_activity = max(0.0, float(student.Physical_Activity_Hours))

    return {
        "Study_Hours": float(student.Study_Hours),
        "Age": int(student.Age),
        "Avg_Daily_Usage_Hours": float(student.Avg_Daily_Usage_Hours),
        "Daily_Unlocks": int(student.Daily_Unlocks),
        "Physical_Activity_Hours": physical_activity,
        "Sleep_Hours_Per_Night": float(student.Sleep_Hours_Per_Night),
        "Stress_Level": student.Stress_Level.value,
        "Gender": student.Gender.value,
        "Academic_Level": student.Academic_Level.value,
        "Most_Used_Platform": student.Most_Used_Platform.value,
        "Purpose_Of_Use": student.Purpose_Of_Use.value,
        "Grouped_country": grouped_country,
    }


# --- API Routes ---
@app.get("/", tags=["General"])
def root():
    """Serve the existing frontend application."""
    return FileResponse(INDEX_FILE, media_type="text/html")


@app.get("/style.css", include_in_schema=False)
def frontend_stylesheet():
    """Serve the stylesheet linked from the existing frontend."""
    return FileResponse(STYLE_FILE, media_type="text/css")


@app.get("/script.js", include_in_schema=False)
def frontend_script():
    """Serve the JavaScript linked from the existing frontend."""
    return FileResponse(SCRIPT_FILE, media_type="application/javascript")


@app.get("/health", tags=["General"])
def health_check():
    """Health check endpoint to verify server and model status."""
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "model_file_exists": os.path.exists(MODEL_FILE),
    }


@app.get("/model-info", tags=["Model"])
def model_info():
    """Returns metadata regarding features, required format, and model state."""
    categories = MODEL_CATEGORIES if model is not None else {}
    return {
        "model_type": "RandomForestRegressor Pipeline with Skewed, Plain Numeric, Ordinal, and Nominal transformers",
        "target": "Mental_Health_Score",
        "top_countries_supported": categories.get("Grouped_country", []),
        "stress_levels": categories.get("Stress_Level", []),
        "genders": categories.get("Gender", []),
        "academic_levels": categories.get("Academic_Level", []),
        "platforms": categories.get("Most_Used_Platform", []),
        "purposes": categories.get("Purpose_Of_Use", []),
    }


@app.post("/predict", response_model=PredictionResult, tags=["Inference"])
def predict_single(data: StudentInput):
    """Predict mental health score for an individual student."""
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not loaded. Ensure Mental_Health_Model.pkl is present and valid.",
        )

    try:
        feature_dict = prepare_features(data)
        input_df = pd.DataFrame([feature_dict])
        prediction = float(model.predict(input_df)[0])
        prediction = round(prediction, 2)

        return PredictionResult(
            predicted_mental_health_score=prediction,
            risk_category=categorize_mental_health(prediction),
            status="success",
        )
    except Exception as e:
        logger.error(f"Inference error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Prediction error: {str(e)}",
        )


@app.post("/predict/batch", response_model=BatchPredictionResponse, tags=["Inference"])
def predict_batch(batch_data: BatchPredictionRequest):
    """Predict mental health scores for multiple students at once."""
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not loaded. Ensure Mental_Health_Model.pkl is present and valid.",
        )

    if not batch_data.students:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The students list cannot be empty.",
        )

    try:
        features_list = [prepare_features(s) for s in batch_data.students]
        input_df = pd.DataFrame(features_list)
        predictions = model.predict(input_df)

        results = []
        for pred in predictions:
            score = round(float(pred), 2)
            results.append(
                PredictionResult(
                    predicted_mental_health_score=score,
                    risk_category=categorize_mental_health(score),
                    status="success",
                )
            )

        return BatchPredictionResponse(total=len(results), predictions=results)
    except Exception as e:
        logger.error(f"Batch inference error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch prediction error: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
