import { useState, useEffect, useRef } from 'react'
import * as Network from 'expo-network'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Message } from '../_types'
import { OnlineProvider } from '../_services/OnlineProvider'
import { useModel } from '../_context/ModelContext'
import { Alert, Platform } from 'react-native'
import * as Location from 'expo-location'

const online = new OnlineProvider()

export function useChat() {
    const { llm, modelReady, setModelMode, modelMode } = useModel()

    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isStreaming, setIsStreaming] = useState(false)
    const locationRef = useRef<string | null>(null)
    const coordsRef = useRef<{ latitude: number, longitude: number } | null>(null)
    const abortControllerRef = useRef<AbortController | null>(null)
    const firstTokenRef = useRef(false)

    const stop = () => {
        abortControllerRef.current?.abort()
    }

    // STREAM OFFLINE TOKENS
    useEffect(() => {
        if (llm.response) {
            setMessages(prev => {
                const last = prev[prev.length - 1]
                return [...prev.slice(0, -1), { ...last, text: llm.response }]
            })
        }
    }, [llm.response])

    // STOP LOADING WHEN OFFLINE INFERENCE FINISHES (offline path only)
    useEffect(() => {
        if (modelMode === 'offline' && !llm.isGenerating && isLoading) {
            setIsLoading(false)
        }
    }, [llm.isGenerating, isLoading, modelMode])

    // LOAD MESSAGES
    const loadMessages = async () => {
        try {
            const saved = await AsyncStorage.getItem('chat messages')
            if (saved) setMessages(JSON.parse(saved))
        } catch (error) {
            console.error('Error loading messages:', error)
        }
    }

    // SAVE MESSAGES
    const saveMessages = async (msgs: Message[]) => {
        try {
            await AsyncStorage.setItem('chat messages', JSON.stringify(msgs))
        } catch (error) {
            console.error('Error saving messages:', error)
        }
    }

    // RESTART CONVERSATION
    const restartConversation = async () => {
        if (modelReady) {
            llm.configure({
                chatConfig: {
                    systemPrompt: 'You are Bluai, an offline hurricane survival assistant serving residents of Mexico. FORMAT: Maximum 80 words. Short sentences. Bullet points for steps. RULES: 1. Always respond in simple Spanish. No English. 2. Be calm and reassuring but never minimize real danger. 3. You are fully offline. Do not reference websites, phone numbers or live data. Never assume outcomes about people, locations, or safety status. If asked for real-time information, tell the user to check local radio or authorities. 4. Prioritize immediate safety first, then practical next steps.'
                }
            })
        }
        setMessages([])
        saveMessages([])
    }

    // Handle resolve location and weather                                                                                                 
    useEffect(() => {                                                                                  
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync()                      
            if (status !== 'granted') return
            const { coords } = await Location.getCurrentPositionAsync({})                              
            const [place] = await Location.reverseGeocodeAsync(coords)
            coordsRef.current = { latitude: coords.latitude, longitude: coords.longitude }                
            if (place) locationRef.current = `${place.city}, ${place.region}, ${place.country}`
        })()                                                                                           
    }, [])        

    // HANDLE SEND MESSAGE
    const handleSendMessage = async () => {
        if (!input.trim()) return

        const userMessage: Message = {
            role: 'user',
            text: input,
            timestamp: new Date().toISOString(),
        }

        setMessages(prev => [...prev, userMessage])
        setMessages(prev => [...prev, { role: 'bot', text: '', timestamp: new Date().toISOString() }])
        setInput('')
        setIsLoading(true)
        console.log('ai_message_send', { length: input.length })

        try {
            const status = await Network.getNetworkStateAsync()
            const hasInternet = status.isConnected && status.isInternetReachable

            if (!hasInternet) {
                setModelMode('offline')
                if (!modelReady) {
                    console.log('[useChat] offline + model not ready — showing error fallback')
                    // On iOS the offline model isn't offered (see SettingsScreen), so
                    // pointing the user at Ajustes would send them to a card that
                    // doesn't exist there.
                    const errorText = Platform.OS === 'ios'
                        ? 'Sin conexión. Conéctate a internet para usar el asistente.'
                        : 'Sin conexión y modelo IA no descargado. Conéctate a internet o descarga el modelo IA desde Ajustes.'
                    setMessages(prev => {
                        if (prev.length === 0) return prev
                        const last = prev[prev.length - 1]
                        if (last.role !== 'bot') return prev
                        return [...prev.slice(0, -1), { ...last, text: errorText, error: true }]
                    })
                    setIsLoading(false)
                    return
                }
                console.log('[useChat] routing → offline')
                llm.sendMessage(input)
                // isLoading cleared by llm.isGenerating effect above
            } else {
                console.log('[useChat] routing → online (OpenRouter)')
                setModelMode('online')
                const historyForAPI = [...messages, userMessage]
                abortControllerRef.current = new AbortController()
                firstTokenRef.current = false
                await online.sendMessage(
                    historyForAPI,
                    locationRef.current,
                    coordsRef.current?.latitude ?? null,
                    coordsRef.current?.longitude ?? null,
                    (token) => {
                        if (!firstTokenRef.current) {
                            firstTokenRef.current = true
                            setIsLoading(false)
                            setIsStreaming(true)
                        }
                        setMessages(prev => {
                            if (prev.length === 0) return prev
                            const last = prev[prev.length - 1]
                            if (last.role !== 'bot') return prev
                            return [...prev.slice(0, -1), { ...last, text: last.text + token }]
                        })
                    },
                    abortControllerRef.current.signal,
                )
                console.log('ai_response_received')
                abortControllerRef.current = null
                setIsStreaming(false)
                setIsLoading(false)
            }
        } catch (error) {
            console.error('Error sending message:', error)
            const errorText = 'Ocurrió un error con el asistente.'
            setMessages(prev => [...prev, {
                role: 'bot',
                text: errorText,
                timestamp: new Date().toISOString(),
                error: true
            }])
            Alert.alert('Error', errorText)
            setIsStreaming(false)
            setIsLoading(false)
            abortControllerRef.current = null
        }
    }

    useEffect(() => { loadMessages() }, [])
    useEffect(() => { saveMessages(messages) }, [messages])

    return { messages, input, setInput, isLoading, isStreaming, restartConversation, handleSendMessage, stop }
}
