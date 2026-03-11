// Import word list (10,000 most common English words)
import words from 'an-array-of-english-words'

// Filter and sort by common usage
const COMMON_WORDS = words
  .filter((word: string) => word.length >= 2 && word.length <= 15) // Reasonable length
  .map((word: string) => word.toLowerCase())

// Top 1000 most common words (manually curated for better suggestions)
const FREQUENT_WORDS = [
  'the', 'be', 'to', 'of', 'in', 'that', 'have', 'i', 'are',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
  'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
  'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 
  // Add more common words
  'hello', 'hi', 'hey', 'yes', 'no', 'please', 'thank', 'thanks', 'sorry', 'excuse',
  'help', 'need', 'want', 'like', 'love', 'hate', 'good', 'bad', 'great', 'okay',
  'happy', 'sad', 'angry', 'tired', 'hungry', 'thirsty', 'hot', 'cold', 'big', 'small',
  'house', 'home', 'school', 'work', 'car', 'food', 'water', 'phone', 'computer', 'friend',
  'family', 'mother', 'father', 'sister', 'brother', 'child', 'baby', 'man', 'woman', 'person',
  'today', 'tomorrow', 'yesterday', 'morning', 'afternoon', 'evening', 'night', 'week', 'month', 'year',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eat', 'drink', 'sleep', 'walk', 'run', 'sit', 'stand', 'go', 'come', 'stop',
  'open', 'close', 'start', 'end', 'begin', 'finish', 'read', 'write', 'listen', 'speak',
  'question', 'answer', 'problem', 'solution', 'idea', 'thought', 'feeling', 'emotion',
  'right', 'left', 'up', 'down', 'here', 'there', 'where', 'when', 'why', 'how',
]

export interface WordSuggestion {
  word: string
  score: number // Relevance score
}

/**
 * Get word suggestions based on current input
 */
export function getWordSuggestions(
  currentWord: string, 
  maxSuggestions: number = 6
): WordSuggestion[] {
  if (!currentWord || currentWord.length === 0) {
    return []
  }
  
  const lowerInput = currentWord.toLowerCase()
  
  // Find matching words
  const matches: WordSuggestion[] = []
  
  // First, check frequent words (higher priority)
  FREQUENT_WORDS.forEach(word => {
    if (word.startsWith(lowerInput)) {
      matches.push({
        word,
        score: 100 - word.length + (word === lowerInput ? 50 : 0) // Exact match gets bonus
      })
    }
  })
  
  // If we need more, check all words
  if (matches.length < maxSuggestions) {
    COMMON_WORDS.forEach(word => {
      if (word.startsWith(lowerInput) && !matches.find(m => m.word === word)) {
        matches.push({
          word,
          score: 50 - word.length
        })
      }
    })
  }
  
  // Sort by score (descending) and return top N
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions)
}

/**
 * Check if a word exists in dictionary
 */
export function isValidWord(word: string): boolean {
  const lower = word.toLowerCase()
  return FREQUENT_WORDS.includes(lower) || COMMON_WORDS.includes(lower)
}

/**
 * Get auto-complete suggestion (most likely word)
 */
export function getAutoComplete(currentWord: string): string | null {
  const suggestions = getWordSuggestions(currentWord, 1)
  return suggestions.length > 0 ? suggestions[0].word : null
}