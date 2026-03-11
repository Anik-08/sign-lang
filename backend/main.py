from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import pickle
import json
import numpy as np
import mediapipe as mp
import cv2
import base64
from PIL import Image
import io
import time

app = FastAPI(title="ASL Landmark Classifier")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ FIX: Define the actual class names (A-Z)
ACTUAL_CLASSES = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'SPACE'
]

# Load model
print("🔄 Loading model...")

try:
    with open('landmark_model_best.pkl', 'rb') as f:
        model = pickle.load(f)
    print("✅ Model loaded successfully!")
    
    # Check model classes
    if hasattr(model, 'classes_'):
        model_classes = [str(c) for c in model.classes_]
        print(f"✅ Model has {len(model_classes)} classes (indices)")
        
        # ✅ Create mapping from model indices to actual letters
        # Model classes: ['0', '1', '2', ..., '25']
        # Actual classes: ['A', 'B', 'C', ..., 'Z']
        
        if len(model_classes) == len(ACTUAL_CLASSES):
            # Create index to letter mapping
            INDEX_TO_LETTER = {}
            for i, model_cls in enumerate(model_classes):
                INDEX_TO_LETTER[int(model_cls)] = ACTUAL_CLASSES[i]
            
            print(f"✅ Created mapping: {len(INDEX_TO_LETTER)} classes")
            print(f"   Example: 0→A, 1→B, 2→C, ..., 25→Z")
            CLASSES = ACTUAL_CLASSES
        else:
            print(f"⚠️  Class count mismatch: {len(model_classes)} != {len(ACTUAL_CLASSES)}")
            CLASSES = ACTUAL_CLASSES
            INDEX_TO_LETTER = {i: ACTUAL_CLASSES[i] for i in range(len(ACTUAL_CLASSES))}
    else:
        print("⚠️  Model doesn't have classes_ attribute")
        CLASSES = ACTUAL_CLASSES
        INDEX_TO_LETTER = {i: ACTUAL_CLASSES[i] for i in range(len(ACTUAL_CLASSES))}
        
except FileNotFoundError:
    print("❌ ERROR: landmark_model_best.pkl not found!")
    exit(1)
except Exception as e:
    print(f"❌ ERROR loading model: {e}")
    exit(1)

# Load metadata
try:
    with open('landmark_model_info.json', 'r') as f:
        metadata = json.load(f)
    print(f"✅ Model type: {metadata.get('best_model', 'Unknown')}")
    print(f"✅ Test accuracy: {metadata.get('test_accuracy', 0.0):.4f}")
except FileNotFoundError:
    metadata = {"best_model": "Landmark Model", "test_accuracy": 0.0}
    print("⚠️  landmark_model_info.json not found")

# MediaPipe setup
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

hands_detector = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

print("✅ MediaPipe initialized")
print(f"\n{'='*60}")
print(f"🎯 Ready to detect: A-Z ({len(CLASSES)} classes)")
print(f"{'='*60}\n")

def extract_landmarks(image_rgb):
    """Extract 21 hand landmarks (63 features)"""
    results = hands_detector.process(image_rgb)
    
    if results.multi_hand_landmarks:
        hand_landmarks = results.multi_hand_landmarks[0]
        
        landmarks = []
        for lm in hand_landmarks.landmark:
            landmarks.extend([lm.x, lm.y, lm.z])
        
        return np.array(landmarks, dtype=np.float32).reshape(1, -1), hand_landmarks
    
    return None, None

def create_skeleton_visualization(image_rgb, hand_landmarks):
    """Draw hand skeleton on white canvas"""
    h, w = image_rgb.shape[:2]
    
    skeleton_canvas = np.ones((h, w, 3), dtype=np.uint8) * 255
    
    mp_drawing.draw_landmarks(
        skeleton_canvas,
        hand_landmarks,
        mp_hands.HAND_CONNECTIONS,
        mp_drawing_styles.get_default_hand_landmarks_style(),
        mp_drawing_styles.get_default_hand_connections_style()
    )
    
    return skeleton_canvas

@app.get("/")
async def root():
    return {
        "message": "ASL Landmark Classifier API",
        "status": "online",
        "model": metadata.get('best_model', 'Landmark Model'),
        "accuracy": float(metadata.get('test_accuracy', 0.0)),
        "classes": CLASSES,
        "total_classes": len(CLASSES)
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": True,
        "mediapipe_ready": True,
        "classes": CLASSES
    }

@app.websocket("/ws/predict")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ Client connected")
    
    try:
        while True:
            data = await websocket.receive_text()
            start_time = time.time()
            
            try:
                payload = json.loads(data)
                frame_base64 = payload.get("frame", "")
                
                # Decode image
                img_data = base64.b64decode(frame_base64.split(",")[1])
                image = Image.open(io.BytesIO(img_data)).convert("RGB")
                img_array = np.array(image, dtype=np.uint8)
                
                # Extract landmarks
                features, hand_landmarks = extract_landmarks(img_array)
                
                if features is None:
                    await websocket.send_json({
                        "success": False,
                        "error": "No hand detected",
                        "hand_detected": False,
                        "predicted_class": "",
                        "confidence": 0.0,
                        "top_5": [],
                        "latency": round((time.time() - start_time) * 1000, 2)
                    })
                    continue
                
                # Predict
                prediction_idx = model.predict(features)[0]
                probabilities = model.predict_proba(features)[0]
                
                # ✅ FIX: Map index to actual letter
                if isinstance(prediction_idx, str):
                    # If model returns string index like '0', '1', '2'
                    prediction_idx = int(prediction_idx)
                
                # Map to actual letter
                prediction = INDEX_TO_LETTER.get(prediction_idx, f"Unknown_{prediction_idx}")
                confidence = float(probabilities.max())
                
                # ✅ FIX: Top 5 with actual letters
                top5_idx = np.argsort(probabilities)[-5:][::-1]
                top_5 = []
                
                for i in top5_idx:
                    idx = int(i)
                    letter = INDEX_TO_LETTER.get(idx, f"Unknown_{idx}")
                    top_5.append({
                        "class": letter,
                        "confidence": round(float(probabilities[idx]), 4)
                    })
                
                # Create skeleton
                skeleton_img = create_skeleton_visualization(img_array, hand_landmarks)
                
                # Convert to base64
                skeleton_pil = Image.fromarray(skeleton_img)
                buffered = io.BytesIO()
                skeleton_pil.save(buffered, format="JPEG", quality=90)
                skeleton_b64 = f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode()}"
                
                latency = (time.time() - start_time) * 1000
                
                # Send response
                await websocket.send_json({
                    "success": True,
                    "predicted_class": prediction,
                    "confidence": round(confidence, 4),
                    "top_5": top_5,
                    "hand_detected": True,
                    "skeleton_frame": skeleton_b64,
                    "latency": round(latency, 2)
                })
                
            except json.JSONDecodeError:
                await websocket.send_json({
                    "success": False,
                    "error": "Invalid JSON",
                    "hand_detected": False
                })
            except Exception as e:
                print(f"❌ Error: {e}")
                import traceback
                traceback.print_exc()
                await websocket.send_json({
                    "success": False,
                    "error": str(e),
                    "hand_detected": False
                })
    
    except WebSocketDisconnect:
        print("❌ Client disconnected")

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting server...")
    print("📍 API: http://localhost:8000")
    print("📍 WebSocket: ws://localhost:8000/ws/predict\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")