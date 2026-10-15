import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Platform, View, Text, ImageBackground } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { GoogleSigninButton } from '@react-native-google-signin/google-signin'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useAuth } from '../../features/auth/AuthContext'
import BluaiLogo from '../../assets/images/BLUAI_LOGO_BLANCO.svg'

export default function LoginScreen() {
  const { signInWithGoogle, signInWithApple, loading, signingIn, error } = useAuth()
  const [appleAvailable, setAppleAvailable] = useState(false)

  useEffect(() => {
    if (Platform.OS !== 'ios') return
    AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false))
  }, [])

  // The inline text alone was easy to miss over the photo — App Review reported a
  // failed sign-in as "does not action". A native Alert can't be overlooked.
  useEffect(() => {
    if (error) Alert.alert('Inicio de sesión', error)
  }, [error])

  if (loading) {
    return (
      <ImageBackground source={require("../../assets/images/BACK-PANTALLA-INICIO.png")} resizeMode="cover" className="flex-1">
        <BluaiLogo width={160} height={124} />
      </ImageBackground>
    )
  }

  return (
    <ImageBackground source={require("../../assets/images/BACK-PANTALLA-INICIO.png")} resizeMode="cover" className="flex-1">
      <SafeAreaView className="flex-1 items-center justify-between px-8 py-12">
        <View className="flex-1 items-center justify-center gap-4">
          <BluaiLogo width={180} height={140} />
          <Text className="text-white/70 font-poppins text-base tracking-widest uppercase">
            Protección ante huracanes
          </Text>
        </View>

        <View className="w-full items-center gap-3">
          {error && (
            <View className="rounded-lg bg-black/60 px-4 py-2">
              <Text className="text-brand-red text-base text-center font-poppins">
                {error}
              </Text>
            </View>
          )}
          <View style={{ opacity: signingIn ? 0.5 : 1 }}>
            <GoogleSigninButton
              size={GoogleSigninButton.Size.Wide}
              color={GoogleSigninButton.Color.Dark}
              onPress={signInWithGoogle}
              disabled={signingIn}
            />
          </View>
          {Platform.OS === 'ios' && appleAvailable && (
            <View style={{ opacity: signingIn ? 0.5 : 1, width: 312 }}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={4}
                style={{ width: 312, height: 48 }}
                // Always bound: `signInWithApple` guards re-entry itself. Swapping the
                // handler to `undefined` is what left the button dead when a request hung.
                onPress={signInWithApple}
              />
            </View>
          )}
          {signingIn && (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator color="#FFFFFF" />
              <Text className="text-white/80 font-poppins text-sm">Iniciando sesión…</Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </ImageBackground>
  )
}
