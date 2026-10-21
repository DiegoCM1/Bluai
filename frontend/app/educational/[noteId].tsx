import '../../global.css';
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { track } from '../../utils/analytics';
import { useEducational } from './_context/EducationalContext';
import { getNoteById } from './_services/contentService';
import { Note } from './_types';
import MarkdownRenderer from './_components/MarkdownRenderer';

export default function NoteDetailScreen() {
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const router = useRouter();
  const { colorScheme } = useTheme();
  const { addToHistory, addFavorite, removeFavorite, isFavorite } = useEducational();

  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNote();
  }, [noteId]);

  const loadNote = async () => {
    try {
      if (!noteId) {
        throw new Error('Note ID not provided');
      }

      const noteData = await getNoteById(noteId);

      if (!noteData) {
        throw new Error('Note not found');
      }

      setNote(noteData);
      addToHistory(noteId);

      track('educational_note_detail_view', {
        noteId,
        noteTitle: noteData.title,
        category: noteData.category,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading note');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFavorite = () => {
    if (!noteId) return;

    if (isFavorite(noteId)) {
      removeFavorite(noteId);
      track('educational_favorite_removed', { noteId, noteTitle: note?.title });
    } else {
      addFavorite(noteId);
      track('educational_favorite_added', { noteId, noteTitle: note?.title });
    }
  };

  const iconColor = colorScheme === 'dark' ? 'rgb(60, 200, 220)' : 'rgb(50, 180, 200)';

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-transparent items-center justify-center">
        <ActivityIndicator size="large" color={iconColor} />
      </SafeAreaView>
    );
  }

  if (error || !note) {
    return (
      <SafeAreaView className="flex-1 bg-transparent items-center justify-center px-6">
        <Ionicons name="alert-circle-outline" size={64} color="#EF4444" />
        <Text className="text-xl font-bold text-phase2Titles mt-4">
          {error || 'Nota no encontrada'}
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          className="mt-6 bg-brand-blue px-6 py-3 rounded-xl"
        >
          <Text className="text-white font-semibold">
            Volver
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const favorite = noteId ? isFavorite(noteId) : false;

  return (
    <SafeAreaView
      className="flex-1 bg-transparent"
      edges={['bottom']}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-6 py-4 border-b border-gray-200">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 items-center justify-center"
        >
          <Ionicons
            name="arrow-back"
            size={24}
            color={colorScheme === 'dark' ? '#E5E7EB' : '#111827'}
          />
        </TouchableOpacity>

        <Text
          className="flex-1 text-lg font-bold text-center text-phase2Titles mx-4"
          numberOfLines={1}
        >
          {note.title}
        </Text>

        <TouchableOpacity
          onPress={handleToggleFavorite}
          className="w-10 h-10 items-center justify-center"
        >
          <Ionicons
            name={favorite ? 'heart' : 'heart-outline'}
            size={24}
            color={favorite ? '#EF4444' : iconColor}
          />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Meta info */}
        <View className="flex-row items-center mb-6 pb-4 border-b border-gray-200">
          <View className="flex-row items-center mr-6">
            <Ionicons
              name="time-outline"
              size={20}
              color={colorScheme === 'dark' ? '#9CA3AF' : '#6B7280'}
            />
            <Text className="text-sm text-phase2SecondaryTxt ml-2">
              {note.readTime} min de lectura
            </Text>
          </View>

          <View className="bg-brand-blue/10 px-3 py-1 rounded-full">
            <Text className="text-sm text-brand-blue capitalize">
              {note.category.replace('-', ' ')}
            </Text>
          </View>
        </View>

        {/* Markdown content */}
        <MarkdownRenderer content={note.content} />

        {/* Bottom spacing */}
        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
