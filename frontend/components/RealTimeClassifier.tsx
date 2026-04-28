'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { getWordSuggestions, isValidWord, WordSuggestion } from '../lib/wordDictionary' 

const WS_URL = process.env.NEXT_PUBLIC_WS_URL!
const CONFIDENCE_THRESHOLD = 0.85
const SMOOTHING_WINDOW = 5

interface Prediction {
  class: string
  confidence: number
}

interface PredictionResult {
  success: boolean
  predicted_class: string
  confidence: number
  top_5: Prediction[]
  latency?: number
  hand_detected: boolean
  skeleton_frame?: string
  error?: string
}

export default function HandSignDetector() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const skeletonCanvasRef = useRef<HTMLCanvasElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  
  const [isActive, setIsActive] = useState(false)
  const [result, setResult] = useState<PredictionResult | null>(null)
  const [stableResult, setStableResult] = useState<string | null>(null)
  const [stableConfidence, setStableConfidence] = useState<number>(0)
  const [fps, setFps] = useState(0)
  const [error, setError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  
  const frameCountRef = useRef(0)
  const lastTimeRef = useRef(Date.now())
  const predictionBufferRef = useRef<Array<{class: string, confidence: number}>>([])
  
  const [currentWord, setCurrentWord] = useState<string>('')
  const [completedWords, setCompletedWords] = useState<string[]>([])
  const [wordSuggestions, setWordSuggestions] = useState<WordSuggestion[]>([])
  const [lastDetectedLetter, setLastDetectedLetter] = useState<string | null>(null)
  const lastDetectionTimeRef = useRef<number>(0)

  const LETTER_COOLDOWN = 1500 // ms

  const ROI_SIZE = 300

  const getStablePrediction = useCallback((newPrediction: string, newConfidence: number) => {
    if (newConfidence >= CONFIDENCE_THRESHOLD) {
      predictionBufferRef.current.push({ 
        class: newPrediction, 
        confidence: newConfidence 
      })
      
      if (predictionBufferRef.current.length > SMOOTHING_WINDOW) {
        predictionBufferRef.current.shift()
      }
      
      const votes: { [key: string]: { count: number, totalConf: number } } = {}
      
      predictionBufferRef.current.forEach(pred => {
        if (!votes[pred.class]) {
          votes[pred.class] = { count: 0, totalConf: 0 }
        }
        votes[pred.class].count++
        votes[pred.class].totalConf += pred.confidence
      })
      
      let winner = { class: '', count: 0, avgConf: 0 }
      Object.entries(votes).forEach(([className, data]) => {
        const avgConf = data.totalConf / data.count
        if (data.count > winner.count || 
           (data.count === winner.count && avgConf > winner.avgConf)) {
          winner = { class: className, count: data.count, avgConf }
        }
      })
      
      if (winner.count >= 3) {
        return { class: winner.class, confidence: winner.avgConf }
      }
    } else {
      predictionBufferRef.current = []
    }
    
    return null
  }, [])

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      
      setError('')
      return true
    } catch (err: any) {
      setError('Camera access denied. Please allow camera permissions.')
      return false
    }
  }

  const stopWebcam = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach(track => track.stop())
      videoRef.current.srcObject = null
    }
  }

  const connectWebSocket = () => {
  setConnectionStatus('connecting')
  const ws = new WebSocket(WS_URL)
  
  ws.onopen = () => {
    console.log('✅ WebSocket connected')
    setConnectionStatus('connected')
    setError('')
  }
  
  ws.onmessage = (event) => {
    try {
      const data: PredictionResult = JSON.parse(event.data)
      setResult(data)
      
      if (data.skeleton_frame && skeletonCanvasRef.current) {
        const img = new Image()
        img.onload = () => {
          const ctx = skeletonCanvasRef.current?.getContext('2d')
          if (ctx) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
            ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height)
          }
        }
        img.src = data.skeleton_frame
      }
      
      if (data.success && data.hand_detected && data.top_5 && data.top_5.length > 0) {
        const topPrediction = data.top_5[0]
        
        const stable = getStablePrediction(topPrediction.class, topPrediction.confidence)
        if (stable) {
          setStableResult(stable.class)
          setStableConfidence(stable.confidence)
          
          // ✅ Word building logic
          const now = Date.now()
          const detectedLetter = stable.class.toUpperCase()
          
          if (now - lastDetectionTimeRef.current > LETTER_COOLDOWN) {
            if (detectedLetter === 'SPACE') {
              if (currentWord.length > 0) {
                setCompletedWords(prev => [...prev, currentWord])
                setCurrentWord('')
                setWordSuggestions([])
                setLastDetectedLetter(null)
                lastDetectionTimeRef.current = now
                console.log('✅ Word completed:', currentWord)
              }
            } else {
              if (detectedLetter !== lastDetectedLetter || now - lastDetectionTimeRef.current > 3000) {
                const newWord = currentWord + detectedLetter
                setCurrentWord(newWord)
                setLastDetectedLetter(detectedLetter)
                
                const suggestions = getWordSuggestions(newWord)
                setWordSuggestions(suggestions)
                
                lastDetectionTimeRef.current = now
                console.log('✅ Letter added:', detectedLetter, '| Current word:', newWord)
              }
            }
          }
        } else {
          setStableResult(null)
          setStableConfidence(0)
        }
      } else {
        setStableResult(null)
        setStableConfidence(0)
      }
      
      frameCountRef.current++
      const now = Date.now()
      const elapsed = (now - lastTimeRef.current) / 1000
      if (elapsed >= 1) {
        setFps(Math.round(frameCountRef.current / elapsed))
        frameCountRef.current = 0
        lastTimeRef.current = now
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err)
    }
  }
  
  ws.onerror = () => {
    setError('Connection failed. Ensure backend is running on port 8000.')
    setConnectionStatus('disconnected')
  }
  
  ws.onclose = () => {
    console.log('❌ WebSocket disconnected')
    setConnectionStatus('disconnected')
  }
  
  wsRef.current = ws
}

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setConnectionStatus('disconnected')
  }

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !wsRef.current) return
    if (wsRef.current.readyState !== WebSocket.OPEN) return
    
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    
    if (!ctx || !video.videoWidth || !video.videoHeight) return
    
    const centerX = video.videoWidth / 2
    const centerY = video.videoHeight / 2
    const boxX = centerX - ROI_SIZE / 2
    const boxY = centerY - ROI_SIZE / 2
    
    canvas.width = ROI_SIZE
    canvas.height = ROI_SIZE
    
    ctx.drawImage(
      video,
      boxX, boxY, ROI_SIZE, ROI_SIZE,
      0, 0, ROI_SIZE, ROI_SIZE
    )
    
    const frame = canvas.toDataURL('image/jpeg', 0.9)
    wsRef.current.send(JSON.stringify({ frame }))
  }, [])

  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(captureFrame, 100)
    return () => clearInterval(interval)
  }, [isActive, captureFrame])

  const toggleDetection = async () => {
    if (isActive) {
      setIsActive(false)
      disconnectWebSocket()
      stopWebcam()
      setResult(null)
      setStableResult(null)
      setStableConfidence(0)
      setFps(0)
      predictionBufferRef.current = []
    } else {
      const webcamOk = await startWebcam()
      if (webcamOk) {
        connectWebSocket()
        setIsActive(true)
      }
    }
  }
  
  // ✅ Confirm current word manually (button click)
  const confirmCurrentWord = () => {
    if (currentWord.length > 0) {
      setCompletedWords(prev => [...prev, currentWord])
      setCurrentWord('')
      setWordSuggestions([])
      setLastDetectedLetter(null)
      lastDetectionTimeRef.current = 0
    }
  }

  // Clear current word
  const clearCurrentWord = () => {
    setCurrentWord('')
    setWordSuggestions([])
    setLastDetectedLetter(null)
  }

  // Clear all words
  const clearAll = () => {
    setCurrentWord('')
    setCompletedWords([])
    setWordSuggestions([])
    setLastDetectedLetter(null)
    lastDetectionTimeRef.current = 0
  }

  // Remove last letter (backspace)
  const removeLastLetter = () => {
    if (currentWord.length > 0) {
      const newWord = currentWord.slice(0, -1)
      setCurrentWord(newWord)
      const suggestions = getWordSuggestions(newWord)
      setWordSuggestions(suggestions)
    } else if (completedWords.length > 0) {
      // If no current word, remove last completed word
      const lastWord = completedWords[completedWords.length - 1]
      setCompletedWords(prev => prev.slice(0, -1))
      setCurrentWord(lastWord)
      const suggestions = getWordSuggestions(lastWord)
      setWordSuggestions(suggestions)
    }
  }

  // ✅ Select a suggestion and complete word
  const selectSuggestion = (word: string) => {
    setCompletedWords(prev => [...prev, word])
    setCurrentWord('')
    setWordSuggestions([])
    setLastDetectedLetter(null)
    lastDetectionTimeRef.current = 0
  }

  // Get full sentence
  const getFullSentence = () => {
    const words = [...completedWords]
    if (currentWord.length > 0) {
      words.push(`[${currentWord}]`) // Show current word in brackets
    }
    return words.join(' ')
  }
  useEffect(() => {
    return () => {
      disconnectWebSocket()
      stopWebcam()
    }
  }, [])

  return (
    <div style={styles.appContainer}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <h1 style={styles.logo}>
            <span style={styles.logoIcon}>🤚</span>
            <span style={styles.logoText}>ASL Detector</span>
          </h1>
          <div style={styles.headerRight}>
            <div style={styles.connectionBadge}>
              <span style={{
                ...styles.statusDot,
                backgroundColor: connectionStatus === 'connected' ? '#10b981' : 
                               connectionStatus === 'connecting' ? '#f59e0b' : '#6b7280'
              }}></span>
              <span style={styles.statusText}>
                {connectionStatus === 'connected' ? 'Live' : 
                 connectionStatus === 'connecting' ? 'Connecting' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.mainContent}>
        <div style={styles.container}>
          {/* Left Panel - Video Feeds */}
          <div style={styles.leftPanel}>
            <div style={styles.videoCard}>
              <div style={styles.cardHeader}>
                <h2 style={styles.cardTitle}>
                  <span style={styles.cardIcon}>📹</span>
                  Live Camera
                </h2>
              </div>
              <div style={styles.videoWrapper}>
                <video
                  ref={videoRef}
                  style={styles.video}
                  autoPlay
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                
                {isActive && (
                  <div style={{
                    ...styles.roiBox,
                    borderColor: stableResult ? '#10b981' : '#3b82f6'
                  }}>
                    <span style={styles.roiLabel}>
                      {result?.hand_detected ? (stableResult ? '✓ Locked' : 'Detecting...') : '⚠️ No Hand'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div style={styles.videoCard}>
              <div style={styles.cardHeader}>
                <h2 style={styles.cardTitle}>
                  <span style={styles.cardIcon}>🦴</span>
                  Hand Skeleton
                </h2>
              </div>
              <div style={styles.skeletonWrapper}>
                <canvas
                  ref={skeletonCanvasRef}
                  width={300}
                  height={300}
                  style={styles.skeletonCanvas}
                />
                {!isActive && (
                  <div style={styles.placeholder}>
                    <div style={styles.placeholderIcon}>👋</div>
                    <p style={styles.placeholderText}>Start detection to visualize landmarks</p>
                  </div>
                )}
              </div>
            </div>

            {/* Control Button */}
            <button
              onClick={toggleDetection}
              style={isActive ? styles.buttonStop : styles.buttonStart}
              disabled={connectionStatus === 'connecting'}
            >
              <span style={styles.buttonIcon}>
                {connectionStatus === 'connecting' ? '⏳' :
                 isActive ? '⏹️' : '▶️'}
              </span>
              <span style={styles.buttonText}>
                {connectionStatus === 'connecting' ? 'Connecting...' :
                 isActive ? 'Stop Detection' : 'Start Detection'}
              </span>
            </button>

            {error && (
              <div style={styles.errorAlert}>
                <span style={styles.errorIcon}>⚠️</span>
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Right Panel - Predictions & Word Building */}
          <div style={styles.rightPanel}>
            {!isActive ? (
              <div style={styles.instructionsCard}>
                <div style={styles.instructionsIcon}>📖</div>
                <h2 style={styles.instructionsTitle}>How to Use</h2>
                <div style={styles.instructionsList}>
                  <div style={styles.instructionItem}>
                    <span style={styles.instructionNumber}>1</span>
                    <span style={styles.instructionText}>Click &quot;Start Detection&quot;</span>
                  </div>
                  <div style={styles.instructionItem}>
                    <span style={styles.instructionNumber}>2</span>
                    <span style={styles.instructionText}>Sign letters to spell words</span>
                  </div>
                  <div style={styles.instructionItem}>
                    <span style={styles.instructionNumber}>3</span>
                    <span style={styles.instructionText}>Click suggestions or &quot;Confirm&quot;</span>
                  </div>
                  <div style={styles.instructionItem}>
                    <span style={styles.instructionNumber}>4</span>
                    <span style={styles.instructionText}>Sign SPACE or click to finish word</span>
                  </div>
                  <div style={styles.instructionItem}>
                    <span style={styles.instructionNumber}>5</span>
                    <span style={styles.instructionText}>Build complete sentences!</span>
                  </div>
                </div>
                <div style={styles.tip}>
                  <span style={styles.tipIcon}>💡</span>
                  <span style={styles.tipText}>Hold each sign steady for 1.5 seconds</span>
                </div>
              </div>
            ) : (
              <>
                {/* Sentence Display */}
                <div style={styles.sentenceCard}>
                  <div style={styles.sentenceHeader}>
                    <h3 style={styles.sentenceTitle}>
                      <span>📝</span> Sentence Builder
                    </h3>
                    {(completedWords.length > 0 || currentWord.length > 0) && (
                      <button onClick={clearAll} style={styles.clearAllButton}>
                        🗑️ Clear
                      </button>
                    )}
                  </div>
                  
                  <div style={styles.sentenceDisplay}>
                    {completedWords.length === 0 && currentWord.length === 0 ? (
                      <div style={styles.sentencePlaceholder}>
                        Start signing letters to build words...
                      </div>
                    ) : (
                      <div style={styles.sentenceText}>
                        {completedWords.map((word, idx) => (
                          <span key={idx} style={styles.completedWord}>
                            {word}
                          </span>
                        ))}
                        {currentWord.length > 0 && (
                          <span style={styles.currentWordDisplay}>
                            {currentWord}
                            <span style={styles.cursor}>|</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Current Word Controls */}
                  {currentWord.length > 0 && (
                    <div style={styles.wordControls}>
                      <button 
                        onClick={confirmCurrentWord} 
                        style={styles.confirmButton}
                        title="Confirm current word"
                      >
                        ✓ Confirm &quot;{currentWord}&quot;
                      </button>
                      <button 
                        onClick={removeLastLetter} 
                        style={styles.backspaceButton}
                        title="Remove last letter"
                      >
                        ⌫ Backspace
                      </button>
                    </div>
                  )}
                </div>

                {/* Word Suggestions */}
                {wordSuggestions.length > 0 && (
                  <div style={styles.suggestionsCard}>
                    <h4 style={styles.suggestionsTitle}>
                      💡 Suggestions
                    </h4>
                    <div style={styles.suggestionsList}>
                      {wordSuggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          onClick={() => selectSuggestion(suggestion.word)}
                          style={styles.suggestionButton}
                        >
                          <span style={styles.suggestionWord}>{suggestion.word}</span>
                          <span style={styles.suggestionArrow}>→</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Current Letter Detection */}
                <div style={styles.detectionCard}>
                  {stableResult && stableConfidence >= CONFIDENCE_THRESHOLD ? (
                    <div style={styles.detectedLetterContainer} className="fade-in">
                      <div style={styles.detectedLabel}>DETECTING</div>
                      <div style={styles.detectedLetter}>
                        {stableResult === 'SPACE' ? '␣' : stableResult}
                      </div>
                      <div style={styles.detectedConfidence}>
                        <div style={styles.confidenceBar}>
                          <div style={{
                            ...styles.confidenceBarFill,
                            width: `${stableConfidence * 100}%`
                          }}></div>
                        </div>
                        <span style={styles.confidenceText}>
                          {(stableConfidence * 100).toFixed(1)}% Confidence
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div style={styles.waitingContainer}>
                      <div style={styles.waitingIcon}>👀</div>
                      <div style={styles.waitingText}>
                        {result?.hand_detected ? 'Hold steady...' : 'Show hand sign'}
                      </div>
                    </div>
                  )}
                </div>

                {/* Stats */}
                {result && (
                  <div style={styles.statsGrid}>
                    <div style={styles.statCard}>
                      <div style={styles.statIcon}>⚡</div>
                      <div style={styles.statValue}>{fps}</div>
                      <div style={styles.statLabel}>FPS</div>
                    </div>
                    <div style={styles.statCard}>
                      <div style={styles.statIcon}>📝</div>
                      <div style={styles.statValue}>{completedWords.length}</div>
                      <div style={styles.statLabel}>Words</div>
                    </div>
                    <div style={styles.statCard}>
                      <div style={styles.statIcon}>
                        {result.hand_detected ? '✅' : '❌'}
                      </div>
                      <div style={{
                        ...styles.statValue,
                        fontSize: '1.2rem',
                        color: result.hand_detected ? '#10b981' : '#ef4444'
                      }}>
                        {result.hand_detected ? 'Detected' : 'No Hand'}
                      </div>
                      <div style={styles.statLabel}>Status</div>
                    </div>
                  </div>
                )}

                {/* Top 5 Predictions */}
                {result && result.top_5 && result.top_5.length > 0 && (
                  <div style={styles.predictionsCard}>
                    <h3 style={styles.predictionsTitle}>Top Predictions</h3>
                    <div style={styles.predictionsList}>
                      {result.top_5.map((pred, idx) => (
                        <div 
                          key={idx} 
                          style={{
                            ...styles.predictionItem,
                            ...(pred.class === stableResult ? styles.predictionItemActive : {})
                          }}
                        >
                          <div style={styles.predictionRank}>#{idx + 1}</div>
                          <div style={styles.predictionLetter}>{pred.class}</div>
                          <div style={styles.predictionBarContainer}>
                            <div style={styles.predictionBar}>
                              <div style={{
                                ...styles.predictionBarFill,
                                width: `${pred.confidence * 100}%`,
                                backgroundColor: pred.confidence >= CONFIDENCE_THRESHOLD 
                                  ? '#10b981' 
                                  : pred.confidence >= 0.7 ? '#f59e0b' : '#9ca3af'
                              }}></div>
                            </div>
                            <div style={styles.predictionPercent}>
                              {(pred.confidence * 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  appContainer: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  header: {
    background: 'rgba(255, 255, 255, 0.98)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
    padding: '1rem 2rem',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
  headerContent: {
    maxWidth: '1600px',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    margin: 0,
  },
  logoIcon: {
    fontSize: '2rem',
  },
  logoText: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  connectionBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    background: '#f3f4f6',
    borderRadius: '20px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  statusText: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
  },
  mainContent: {
    padding: '2rem',
  },
  container: {
    maxWidth: '1600px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: '1fr 450px',
    gap: '2rem',
  },
  leftPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  videoCard: {
    background: 'white',
    borderRadius: '16px',
    overflow: 'hidden',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  },
  cardHeader: {
    padding: '1.25rem 1.5rem',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
  },
  cardTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#111827',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  cardIcon: {
    fontSize: '1.25rem',
  },
  videoWrapper: {
    position: 'relative',
    background: '#000',
    aspectRatio: '4/3',
  },
  
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  roiBox: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '65%',
    height: '65%',
    border: '3px solid',
    borderRadius: '12px',
    pointerEvents: 'none',
    transition: 'border-color 0.3s',
  },
  roiLabel: {
    position: 'absolute',
    top: '-40px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.85)',
    color: 'white',
    padding: '0.5rem 1.25rem',
    borderRadius: '20px',
    fontSize: '0.875rem',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    backdropFilter: 'blur(10px)',
  },
  skeletonWrapper: {
    position: 'relative',
    background: '#ffffff',
    aspectRatio: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonCanvas: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  placeholder: {
    position: 'absolute',
    textAlign: 'center',
    color: '#9ca3af',
  },
  placeholderIcon: {
    fontSize: '4rem',
    marginBottom: '1rem',
  },
  placeholderText: {
    fontSize: '1rem',
    margin: 0,
  },
  buttonStart: {
    width: '100%',
    padding: '1.25rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1.125rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    boxShadow: '0 4px 6px rgba(16, 185, 129, 0.3)',
    transition: 'all 0.2s',
  },
  buttonStop: {
    width: '100%',
    padding: '1.25rem',
    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1.125rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    boxShadow: '0 4px 6px rgba(239, 68, 68, 0.3)',
    transition: 'all 0.2s',
  },
  buttonIcon: {
    fontSize: '1.5rem',
  },
  buttonText: {
    fontSize: '1.125rem',
  },
  errorAlert: {
    padding: '1rem 1.25rem',
    background: '#fee2e2',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    color: '#dc2626',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    fontWeight: '500',
  },
  errorIcon: {
    fontSize: '1.25rem',
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  instructionsCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '2.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
  },
  instructionsIcon: {
    fontSize: '4rem',
    marginBottom: '1.5rem',
  },
  instructionsTitle: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: '2rem',
  },
  instructionsList: {
    textAlign: 'left',
    marginBottom: '2rem',
  },
  instructionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1rem',
    marginBottom: '0.75rem',
    background: '#f9fafb',
    borderRadius: '8px',
  },
  instructionNumber: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  instructionText: {
    color: '#374151',
    fontSize: '1rem',
    fontWeight: '500',
  },
  tip: {
    padding: '1rem',
    background: '#eff6ff',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  tipIcon: {
    fontSize: '1.5rem',
  },
  tipText: {
    color: '#1e40af',
    fontSize: '0.875rem',
    fontWeight: '500',
  },
  detectionCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '2rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    minHeight: '300px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detectedLetterContainer: {
    textAlign: 'center',
    width: '100%',
  },
  detectedLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280',
    letterSpacing: '0.1em',
    marginBottom: '1rem',
  },
  detectedLetter: {
    fontSize: '10rem',
    fontWeight: 'bold',
    lineHeight: 1,
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    marginBottom: '1.5rem',
    textShadow: '0 4px 8px rgba(16, 185, 129, 0.2)',
  },
  detectedConfidence: {
    marginBottom: '1rem',
  },
  confidenceBar: {
    width: '100%',
    height: '8px',
    background: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '0.5rem',
  },
  confidenceBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
    transition: 'width 0.3s',
  },
  confidenceText: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#059669',
  },
  detectedStatus: {
    marginTop: '1.5rem',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '0.5rem 1.25rem',
    background: '#d1fae5',
    color: '#047857',
    borderRadius: '20px',
    fontSize: '0.875rem',
    fontWeight: '600',
  },
  waitingContainer: {
    textAlign: 'center',
    color: '#9ca3af',
  },
  waitingIcon: {
    fontSize: '4rem',
    marginBottom: '1rem',
  },
  waitingText: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: '0.5rem',
  },
  waitingSubtext: {
    fontSize: '0.875rem',
    color: '#9ca3af',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
  },
  statCard: {
    background: 'white',
    borderRadius: '12px',
    padding: '1.25rem',
    textAlign: 'center',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  statIcon: {
    fontSize: '2rem',
    marginBottom: '0.5rem',
  },
  statValue: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: '0.25rem',
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  predictionsCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '1.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  },
  predictionsTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '1.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  lockedBadge: {
    fontSize: '0.875rem',
    color: '#10b981',
  },
  predictionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  predictionItem: {
    display: 'grid',
    gridTemplateColumns: '40px 50px 1fr',
    alignItems: 'center',
    gap: '1rem',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '8px',
    transition: 'all 0.2s',
  },
  predictionItemActive: {
    background: '#d1fae5',
    borderLeft: '3px solid #10b981',
  },
  predictionRank: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#9ca3af',
  },
  predictionLetter: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: '#111827',
  },
  predictionBarContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  predictionBar: {
    flex: 1,
    height: '8px',
    background: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  predictionBarFill: {
    height: '100%',
    transition: 'width 0.3s',
  },
  predictionPercent: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280',
    minWidth: '60px',
    textAlign: 'right',
  },
  detectedName: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#059669',
    marginTop: '0.5rem',
  },
  sentenceCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '1.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    marginBottom: '1.5rem',
  },
  sentenceHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  sentenceTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#111827',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  clearAllButton: {
    padding: '0.5rem 1rem',
    background: '#fee2e2',
    color: '#dc2626',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  sentenceDisplay: {
    minHeight: '80px',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '8px',
    marginBottom: '1rem',
  },
  sentencePlaceholder: {
    color: '#9ca3af',
    fontSize: '1rem',
    textAlign: 'center',
    padding: '1.5rem',
  },
  sentenceText: {
    fontSize: '1.5rem',
    fontWeight: '500',
    color: '#111827',
    lineHeight: '2',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
  },
  completedWord: {
    color: '#059669',
    fontWeight: '600',
  },
  currentWordDisplay: {
    color: '#3b82f6',
    fontWeight: '600',
    position: 'relative',
  },
  cursor: {
    animation: 'blink 1s infinite',
    marginLeft: '2px',
  },
  wordControls: {
    display: 'flex',
    gap: '0.75rem',
  },
  confirmButton: {
    flex: 1,
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
  },
  backspaceButton: {
    padding: '0.75rem 1rem',
    background: '#f3f4f6',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  suggestionsCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '1.5rem',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    marginBottom: '1.5rem',
  },
  suggestionsTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#374151',
  },
  suggestionsList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '0.75rem',
  },
  suggestionButton: {
    padding: '0.75rem 1rem',
    background: '#eff6ff',
    border: '2px solid #3b82f6',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1e40af',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  suggestionWord: {
    flex: 1,
    textAlign: 'left',
  },
  suggestionArrow: {
    fontSize: '1.2rem',
    opacity: 0.5,
  },
}
