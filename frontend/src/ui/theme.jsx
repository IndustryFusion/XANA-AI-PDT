import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'xana.theme'
export const THEME_CHOICES = ['system', 'dark', 'light']

const ThemeContext = createContext({ choice: 'system', setChoice: () => {} })

function readChoice() {
  const stored = localStorage.getItem(STORAGE_KEY)
  return THEME_CHOICES.includes(stored) ? stored : 'system'
}

/**
 * Applies the operator's theme choice to <html data-theme>. With "system"
 * the attribute is removed and the colour-scheme media query decides.
 */
export function ThemeProvider({ children }) {
  const [choice, setChoiceState] = useState(readChoice)

  useEffect(() => {
    const root = document.documentElement
    if (choice === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', choice)
  }, [choice])

  const setChoice = useCallback((next) => {
    if (!THEME_CHOICES.includes(next)) return
    if (next === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
    setChoiceState(next)
  }, [])

  return <ThemeContext.Provider value={{ choice, setChoice }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeSelect({ id = 'theme-select' }) {
  const { choice, setChoice } = useTheme()
  return (
    <label className="theme-select" htmlFor={id}>
      <span className="visually-hidden">Theme</span>
      <select id={id} value={choice} onChange={(e) => setChoice(e.target.value)}>
        <option value="system">System theme</option>
        <option value="dark">Dark theme</option>
        <option value="light">Light theme</option>
      </select>
    </label>
  )
}
