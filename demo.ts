// @ts-nocheck

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy, startTransition } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useLocation, useRoute } from 'wouter'
import { Recorder } from 'vmsg';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Bot, FileDown, Upload, Play, Mic, Check, Menu, Square, Youtube, ChevronDown, Pause, Layers, AudioWaveform, Sheet, Webhook, Globe, Languages, Combine } from 'lucide-react';
import CombineTasksModal from './CombineTasksModal';
import debounce from 'lodash/debounce';
import ErrorBoundary from './ErrorBoundary';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import UpgradeModal from './UpgradeModal';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoreHorizontal } from 'lucide-react';
import 'react-quill/dist/quill.snow.css';
import { updateTask, fetchTaskById, transcribeTask, uploadFile, summarizeTask, transcribeYouTube, isTaskTranscribing, fetchTasks, combineTasks, uploadAndSummarizePdf, scrapeWebsite } from '@/api/api';
import { useAuthStore } from '../store/authStore';
import { Task, Media, TranscriptionStatus, OutputFormat, TranscriptSegment } from '@/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSidebarStore } from '@/store/sidebarStore';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useTaskStore } from '@/store/taskStore';
import { cn, extractYouTubeId } from '@/lib/utils';
import { useUserInfoStore } from '@/store/creditStore';

const LazyAudioPlayer = lazy(() => import('./AudioPlayer'));
const LazyYouTubePlayer = lazy(() => import('./YouTubePlayer'));
const LazyTranscriptionPreview = lazy(() => import('./TranscriptionPreview'));
const LazyTranscriptDisplay = lazy(() => import('./TranscriptDisplay'));
const LazyReactQuill = lazy(() => import('react-quill'));
const RecorderWrapper = lazy(() => import('./RecorderWrapper'));

const LoadingFallback = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.3 }}
    className="mb-4 bg-gray-100 p-3 md:p-4 rounded-lg shadow-md flex items-center justify-center"
  >
    <motion.div
      animate={{ scale: [1, 1.1, 1] }}
      transition={{ duration: 1, repeat: Infinity }}
      className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"
    />
    <span className="ml-2 text-indigo-600 font-medium">Loading...</span>
  </motion.div>
);
import './AudioTranscribe.css';
import './ReactQuillCustom.css';

interface AudioTranscribeProps {
  token: string | null;
}

const AudioTranscribe: React.FC<AudioTranscribeProps> = ({ token }) => {
  const selectedTask = useTaskStore((state) => state.selectedTask);
  const setSelectedTask = useTaskStore((state) => state.setSelectedTask);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const formatContent = useCallback((content: string): string => {
    return content.replace(/\n/g, '<br>');
  }, []);
  const queryClient = useQueryClient();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const recorderRef = useRef<Recorder | null>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [isTitleBarCollapsed, setIsTitleBarCollapsed] = useState(false);
  const contextToken = useAuthStore((state) => state.token);
  const effectiveToken = token || contextToken;
  const [editedTranscription, setEditedTranscription] = useState('');
  const [isUploading, setIsUploading] = useState<Array<{ status: boolean; taskId: string }>>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const [isWebsiteModalOpen, setIsWebsiteModalOpen] = useState(false);
  const [youTubeUrl, setYouTubeUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [youtubeCurrentTime, setYoutubeCurrentTime] = useState(0);
  const [quillLoaded, setQuillLoaded] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [showTranscript, setShowTranscript] = useState<boolean>(false);
  const credits = useUserInfoStore((state) => state.credits);
  const { isSidebarCollapsed, setIsSidebarCollapsed } = useSidebarStore();  
  const [location, setLocation] = useLocation();

  if (!selectedTask) {
    return null;
  }
  
  const {
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    audioRef,
    togglePlayPause,
    handleSkip,
    handlePlaybackRateChange,
  } = useAudioPlayer(selectedTask);

  const parseTranscriptSegments = useCallback((srtContent: string | null | undefined): TranscriptSegment[] => {
    if (!srtContent) {
      return [];
    }
    try {
      const segments = srtContent.trim().split('\n\n');
      return segments.map((segment, index) => {
        const lines = segment.split('\n');
        if (lines.length < 3) {
          throw new Error(`Invalid segment format at index ${index}`);
        }
        const [id, timeString, ...textLines] = lines;
        const [startTime, endTime] = timeString.split(' --> ').map(timeToSeconds);
        if (isNaN(startTime) || isNaN(endTime)) {
          throw new Error(`Invalid time format at index ${index}`);
        }
        return {
          id: id,
          startTime,
          endTime,
          text: textLines.join('\n')
        };
      });
    } catch (error) {
      console.error('Error parsing transcript segments:', error);
      return [{ id: '1', startTime: 0, endTime: 0, text: 'Error parsing transcript. Please check the format.' }];
    }
  }, [effectiveToken, selectedTask.id, setSelectedTask, queryClient]);

  const updateTaskMutation = useMutation(
    (updateData: { name: string; content: string; download_url?: string | null }) => {
      if (!effectiveToken) throw new Error('No token available');
      return updateTask(effectiveToken, selectedTask.id, updateData);
    },
    {
      onSuccess: () => refetchTask(),
    }
  );

  const timeToSeconds = useCallback((timeString: string): number => {
    try {
      const parts = timeString.split(':');
      if (parts.length === 3) {
        const [hours, minutes, seconds] = parts.map(parseFloat);
        if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
          return hours * 3600 + minutes * 60 + seconds;
        }
      } else if (parts.length === 2) {
        const [minutes, seconds] = parts.map(parseFloat);
        if (!isNaN(minutes) && !isNaN(seconds)) {
          return minutes * 60 + seconds;
        }
      }
      throw new Error('Invalid time format');
    } catch (error) {
      console.error('Error converting time to seconds:', error);
      return 0;
    }
  }, [updateTaskMutation, selectedTask.id, selectedTask.name, selectedTask.content, setSelectedTask]);

  const { refetch: refetchTask } = useQuery(
    ['task', selectedTask.id],
    async () => {
      if (!effectiveToken) throw new Error('No token available');
      if (selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS) {
        const status = await isTaskTranscribing(effectiveToken, selectedTask.id);
        return { status };
      }
      return { status: selectedTask.transcription_status };
    },
    {
      enabled: !!effectiveToken && !!selectedTask.id,
      onError: (error: any) => {
        if (error.response && error.response.status === 404) {
          console.log('Task not found, reloading tasks...');
        }
      },
      onSuccess: async (data) => {
        if (data.status === TranscriptionStatus.COMPLETED) {
          if (effectiveToken) {
            fetchTasks(effectiveToken);
            const updatedTask = await fetchTaskById(effectiveToken, selectedTask.id);
            setSelectedTask(updatedTask);
            setEditedTranscription(formatContent(updatedTask.content || ''));
          } else {
            console.error('No effective token available to fetch updated task');
          }
        }
      },
      refetchInterval: selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS ? 5000 : false,
    }
  );

  const handleTaskChange = useCallback((newTask: Task, token: string) => {
    startTransition(() => {
      setSelectedTask(newTask);
      if (newTask.transcription_status !== TranscriptionStatus.IN_PROGRESS) {
        queryClient.cancelQueries(['task', newTask.id]);
      }
      // if (token && newTask.id !== selectedTask.id && newTask.transcription_status === TranscriptionStatus.IN_PROGRESS)
      //   fetchTasks(token);
      setEditedTranscription(formatContent(newTask.content));
    });
  }, [queryClient, setSelectedTask, formatContent]);

  const handleWebsite = useCallback(async () => {
    if(credits <= 0) {
      setShowUpgradeModal(true);
      return;
    }
    if (!effectiveToken) {
      console.error('No token available');
      return;
    }
    try {
      setIsWebsiteModalOpen(false);
      setSelectedTask({...selectedTask, transcription_status: TranscriptionStatus.IN_PROGRESS});
      console.log('Attempting to scrape website:', websiteUrl);
      const scrapedTask = await scrapeWebsite(effectiveToken, websiteUrl);
      setSelectedTask(scrapedTask);
      useTaskStore.getState().addTask(scrapedTask);
    } catch (error) {
      console.error('Website scraping failed:', error);
      setUploadError(`Website scraping failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [effectiveToken, selectedTask, websiteUrl, credits, setSelectedTask]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    if(credits <= 0) {
      setShowUpgradeModal(true);
      return
    }
    
    const file = event.target.files?.[0]
    
    if(!effectiveToken)
      return

    const updatedTask = await updateTask(effectiveToken, selectedTask.id, {
      transcription_status: TranscriptionStatus.IN_PROGRESS,
    });

    setSelectedTask(updatedTask);

    if (file && effectiveToken) {
      setIsUploading(prev => {
        const existingIndex = prev.findIndex(item => item.taskId === selectedTask.id);
        if (existingIndex !== -1) {
          return prev.map((item, index) =>
            index === existingIndex ? { ...item, status: true } : item
          );
        } else {
          return [...prev, { status: true, taskId: selectedTask.id }];
        }
      });
      setUploadError(null);
      try {
        let updatedTask;
        if (file.type === 'application/pdf') {
          updatedTask = await uploadAndSummarizePdf(effectiveToken, selectedTask.id, file, (progress) => {
            console.log(`Upload and summarize progress: ${progress}%`);
          });
        } else {
          updatedTask = await uploadFile(effectiveToken, selectedTask.id, file, (progressEvent) => {
            if (progressEvent.total) {
              console.log(`Upload progress: ${(progressEvent.loaded / progressEvent.total) * 100}%`);
            } else {
              console.log(`Upload progress: ${progressEvent.loaded} bytes`);
            }
          });
          await transcribeTask(effectiveToken, selectedTask.id);
        }
        setSelectedTask(updatedTask);
        useTaskStore.getState().updateTask(updatedTask);
      } catch (error) {
        console.error('Upload error:', error);
        setUploadError('Failed to upload file. Please try again.');
      } finally {
        setIsUploading(prev => prev.filter(item => item.taskId !== selectedTask.id));
      }
    }
  }, [effectiveToken, selectedTask.id, queryClient, refetchTask, setSelectedTask]);

  const handleRemoveFile = useCallback(() => {
    setUploadError(null);
    if (selectedTask.download_url) {
      // If there's an download_url, we should update the task to remove it
      updateTaskMutation.mutate({
        name: selectedTask.name,
        content: selectedTask.content,
        download_url: null
      });
    }
    // Update the selected task to remove the download_url
    setSelectedTask({
      ...selectedTask,
      media: selectedTask.media ? { ...selectedTask.media, download_url: undefined } : undefined
    });
  }, [effectiveToken, selectedTask.id, youTubeUrl, queryClient, refetchTask, setSelectedTask]);

  const handleTranscribe = useCallback(async () => {
    if(credits <= 0) {
      setShowUpgradeModal(true);
      return
    }
    if (!effectiveToken || !credits) {
      console.error('No token available');
      return;
    }
    try {
      // Check if task is already transcribing
      let isTranscribing = await isTaskTranscribing(effectiveToken, selectedTask.id);

      setSelectedTask({
        ...selectedTask,
        transcription_status: TranscriptionStatus.IN_PROGRESS
      });
      await transcribeTask(effectiveToken, selectedTask.id);
      fetchTasks(effectiveToken)

      isTranscribing = await isTaskTranscribing(effectiveToken, selectedTask.id);
      while (isTranscribing === TranscriptionStatus.IN_PROGRESS) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds
        isTranscribing = await isTaskTranscribing(effectiveToken, selectedTask.id);
      }
      if (isTranscribing === TranscriptionStatus.COMPLETED) {
        if (effectiveToken) {
          const updatedTask = await fetchTaskById(effectiveToken, selectedTask.id);
          startTransition(() => {
            setSelectedTask(updatedTask);
            setEditedTranscription(formatContent(updatedTask.content));
          });
        } else {
          console.error('No effective token available to fetch updated task');
        }
      }
    } catch (error) {
      console.error('Transcription failed:', error);
    }
  }, [effectiveToken, selectedTask.id, selectedTask.name, editedTranscription, selectedTask.download_url, selectedTask.output_format, setSelectedTask, formatContent]);

  const handleYouTubeTranscribe = useCallback(async () => {
    if(credits <= 0) {
      setIsYouTubeModalOpen(false)
      setShowUpgradeModal(true);
      return
    }
    if (!effectiveToken || !credits) {
      console.error('No token available');
      return;
    }
    try {
      setIsYouTubeModalOpen(false);
      const youTubeId = await extractYouTubeId(youTubeUrl);
      if (!youTubeId) {
        throw new Error('Invalid YouTube URL');
      }
      setSelectedTask({...selectedTask, transcription_status: TranscriptionStatus.IN_PROGRESS});
      console.log('Attempting to transcribe YouTube video:', youTubeId);
      await transcribeYouTube(effectiveToken, selectedTask.id, youTubeId);
    } catch (error) {
      console.error('YouTube transcription failed:', error);
      // Display error to user
      setUploadError(`YouTube transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [effectiveToken, selectedTask.id, youTubeUrl, setSelectedTask]);


  const handleEditTranscription = useCallback((content: string, taskId: string) => {
    if (taskId === selectedTask.id) {
      setEditedTranscription(content);
    }
  }, [selectedTask.id]);

  const debouncedHandleEditTranscription = useMemo(
    () => debounce((content: string, taskId: string) => {
      setIsEditing(true);
      handleEditTranscription(content, taskId);
      setIsEditing(false);
    }, 100),
    [handleEditTranscription]
  );

  const handleSaveTranscription = useCallback(async () => {
    if (!effectiveToken) {
      console.error('No token available');
      return;
    }
    if (isEditing) {
      console.log('Editing in progress, please wait...');
      return;
    }
    setIsSaving(true);
    try {
      const updatedTask = await updateTask(effectiveToken, selectedTask.id, {
        content: editedTranscription,
      });
      setSelectedTask(updatedTask);
    } catch (error) {
      console.error('Failed to save transcription:', error);
    } finally {
      setIsSaving(false);
    }
  }, [effectiveToken, selectedTask.id, editedTranscription, setSelectedTask, isEditing]);

  const handleSummarizeAI = useCallback(async () => {
    if(credits <= 0) {
      setShowUpgradeModal(true);
      return
    }
    if (!effectiveToken || !credits) {
      console.error('No token available');
      return;
    }
    try {
      // First, save the current content without modifying it
      const updatedTask = await updateTask(effectiveToken, selectedTask.id, {
        content: editedTranscription,
      });
      
      // Update the local state with the saved content
      setSelectedTask({...updatedTask, transcription_status: TranscriptionStatus.IN_PROGRESS});
      
      // Now proceed with summarization, passing the selected language as a parameter
      await summarizeTask(effectiveToken, selectedTask.id, selectedLanguage);

    } catch (error) {
      console.error('Failed to save or summarize:', error);
      // You might want to show an error message to the user here
      // Reset the transcription status if there's an error
      setSelectedTask({
        ...selectedTask,
        transcription_status: TranscriptionStatus.FAILED
      });
    }
  }, [effectiveToken, selectedTask, editedTranscription, setSelectedTask, selectedLanguage, credits]);

  const [isCombineModalOpen, setIsCombineModalOpen] = useState(false);
  const { data: tasks } = useQuery(['tasks'], () => fetchTasks(effectiveToken || ''));

  const handleCombineTasks = useCallback(() => {
    setIsCombineModalOpen(true);
  }, []);

  const onCombineTasks = useCallback(async (selectedTaskIds: string[]) => {
    if(credits <= 0) {
      setShowUpgradeModal(true);
      return
    }
    if (!effectiveToken || selectedTaskIds.length < 2) {
      console.error('No token available or not enough tasks selected');
      return;
    }
    try {
      const combinedTask = await combineTasks(effectiveToken, selectedTaskIds);
      setSelectedTask(combinedTask);
      
      // Invalidate and refetch tasks after combining
      queryClient.invalidateQueries(['tasks']);

      // Close the combine tasks modal
      setIsCombineModalOpen(false);
    } catch (error) {
      console.error('Failed to combine tasks:', error);
      // You might want to show an error message to the user here
    }
  }, [effectiveToken, queryClient, setSelectedTask, setIsCombineModalOpen]);

  const handleSaveAsFile = useCallback((format: 'srt' | 'markdown') => {
    let content = '';
    let fileExtension = '';

    if (format === 'srt' && selectedTask.transcription_result) {
      content = selectedTask.transcription_result;
      fileExtension = 'srt';
    } else if (format === 'markdown') {
      content = selectedTask.content.replace(/<[^>]+>/g, ''); // Remove HTML tags
      fileExtension = 'md';
    }

    if (content) {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTask.name}.${fileExtension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [effectiveToken, selectedTask.id, queryClient]);

  const startRecording = useCallback(async () => {
    try {
      if (!recorderRef.current) {
        const recorderWrapper = document.createElement('div');
        document.body.appendChild(recorderWrapper);

        // Omitted for internal purpose

        document.body.removeChild(recorderWrapper);
      }

      if (recorderRef.current) {
        await recorderRef.current.initAudio();
        await recorderRef.current.initWorker();
        recorderRef.current.startRecording();
      } else {
        console.error('Recorder not initialized');
        return;
      }

      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);
      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingTime((prevTime) => prevTime + 1);
      }, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (recorderRef.current && isRecording) {
      try {
        const blob = await recorderRef.current.stopRecording();
        setIsRecording(false);
        setIsPaused(false);
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
        }

        if (effectiveToken) {
          try {
            setIsUploading(prev => [...prev, { status: true, taskId: selectedTask.id }]);
            const file = new File([blob], `recording_${Date.now()}.mp3`, { type: 'audio/mpeg' });
            const updatedTask = await uploadFile(effectiveToken, selectedTask.id, file);
            await transcribeTask(effectiveToken, selectedTask.id);
            setSelectedTask(updatedTask);
            fetchTasks(effectiveToken)
          } catch (error) {
            console.error('Failed to upload recorded audio:', error);
            // You might want to show an error message to the user here
          } finally {
            setIsUploading(prev => prev.filter(item => item.taskId !== selectedTask.id));
          }
        }
      } catch (error) {
        console.error('Error stopping recording:', error);
      }
    }
  }, [isRecording, effectiveToken, selectedTask.id, queryClient]);

  const handleRecordClick = useCallback(() => {
    if(credits <= 0) {
      setShowUpgradeModal(true);
      return;
    }
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, stopRecording, startRecording]);

  const handlePauseRecording = useCallback(() => {
    if (isRecording) {
      if (isPaused) {
        setIsPaused(false);
        recordingIntervalRef.current = window.setInterval(() => {
          setRecordingTime((prevTime) => prevTime + 1);
        }, 1000);
      } else {
        setIsPaused(true);
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
        }
      }
    }
  }, [isRecording, isPaused]);

  const formatRecordingTime = useCallback((seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);
   

  useEffect(() => {
    handleTaskChange(selectedTask, effectiveToken || '');
  }, [selectedTask, handleTaskChange, effectiveToken]);

  useEffect(() => {
    setQuillLoaded(true);
  }, []);

  useEffect(() => {
    return () => {
      debouncedHandleEditTranscription.cancel();
    };
  }, [debouncedHandleEditTranscription]);

  useEffect(() => {
    return () => {
      setSelectedTask(null);
    }
  }, [])

  return (
    <Suspense fallback={<div>Loading...</div>}>
    <ErrorBoundary fallback={
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4 glow-effect">Oops! Something went wrong.</h1>
          <p className="text-gray-600 mb-4">We're sorry for the inconvenience. Please try refreshing the page.</p>
          <button 
            onClick={() => window.location.reload()} 
            className="bg-indigo-500 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded"
          >
            Refresh Page
          </button>
        </div>
      </div>
    }>
      <div className="md:flex md:px-6 h-full md:items-center">
        <div className="w-full md:max-w-7xl mx-auto bg-gradient-to-br from-indigo-50 to-purple-50 md:rounded-2xl shadow-2xl p-4 md:pt-4 md:pb-4 md:px-6 pb-14 relative">
          {
            !isMobile && 
            <div className="flex items-center mb-4 justify-between">
              <h1 className="text-xl font-normal bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-blue-600 space-font">
                {selectedTask.name.length > 50 ? `${selectedTask.name.slice(0, 50)}...` : selectedTask.name}
              </h1>
              <div className="flex space-x-2 p-1 self-baseline">
                <div className="w-3 h-3 rounded-full bg-red-400 cursor-pointer" 
                onClick={() => {
                  setSelectedTask(null)
                  setLocation('/')
                }}></div>
                <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                <div className="w-3 h-3 rounded-full bg-green-400 cursor-pointer"
                onClick={() => {
                  setIsSidebarCollapsed(!isSidebarCollapsed)
                }}></div>
              </div>
            </div>
          }
        {isMobile ? (
          <div className={cn("transition-all duration-300 ease-in-out",
            isTitleBarCollapsed ? "h-12 overflow-hidden" : "h-auto")}>
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-2xl font-normal bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-blue-600 space-font">
                {selectedTask.name.length > 20 ? `${selectedTask.name.slice(0, 20)}...` : selectedTask.name}
              </h1>
              <button
                onClick={() => setIsTitleBarCollapsed(!isTitleBarCollapsed)}
                className="p-2 rounded-full hover:bg-gray-200 transition-colors duration-200"
              >
                <Menu size={20} />
              </button>
            </div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2 bg-white rounded-full px-3 py-2.5 shadow-md">
                <Label htmlFor="output-format-toggle" className="text-sm font-medium text-gray-700">
                  {showTranscript ? 'Transcript' : 'Notes'}
                </Label>
                <Switch
                  id="output-format-toggle"
                  checked={showTranscript}
                  onCheckedChange={() => setShowTranscript(!showTranscript)}
                />
              </div>
              <Button
                onClick={handleTranscribe}
                disabled={(!selectedTask.media?.download_url) || selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS || !selectedTask.media?.name?.endsWith('.mp3')}
                className={`w-auto px-4 py-2 text-white rounded-full focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-opacity-50 flex items-center justify-center ${(selectedTask.media?.download_url) && selectedTask.transcription_status !== TranscriptionStatus.IN_PROGRESS
                    ? 'bg-teal-500 hover:bg-teal-600'
                    : 'bg-gray-400 cursor-not-allowed'
                  }`}
              >
                {selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS ? (
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Transcribe
                  </>
                )}
              </Button>
            </div>
            <div className="w-full md:w-1/4 flex flex-col mb-6 md:mb-0">
              {/* YouTube Player */}
              <AnimatePresence>
                {selectedTask.media?.youtube_id && (
                  <Suspense fallback={<LoadingFallback />}>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <LazyYouTubePlayer
                        youtubeId={selectedTask.media.youtube_id}
                        onProgress={({ playedSeconds }) => setYoutubeCurrentTime(playedSeconds)}
                      />
                    </motion.div>
                  </Suspense>
                )}
              </AnimatePresence>
              {/* Audio Player */}
              <AnimatePresence>
                {selectedTask.media?.download_url?.includes('.mp3') && !selectedTask.media?.youtube_id && (
                  <Suspense fallback={<LoadingFallback />}>
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <LazyAudioPlayer
                        downloadUrl={selectedTask.media.download_url}
                        name={selectedTask.media.name || ''}
                        isUploading={isUploading.some(item => item.taskId === selectedTask.id && item.status)}
                        uploadError={uploadError}
                        isPlaying={isPlaying}
                        currentTime={currentTime}
                        duration={duration}
                        playbackRate={playbackRate}
                        togglePlayPause={togglePlayPause}
                        handleSkip={handleSkip}
                        handlePlaybackRateChange={handlePlaybackRateChange}
                        handleRemoveFile={handleRemoveFile}
                        audioRef={audioRef}
                      />
                    </motion.div>
                  </Suspense>
                )}
              </AnimatePresence>

              {/* Transcription Preview */}
              <Suspense fallback={<LoadingFallback />}>
                <LazyTranscriptionPreview
                  transcriptionResult={selectedTask.transcription_result || selectedTask.content}
                  summary={selectedTask.summary}
                  task={selectedTask}
                  setSelectedTask={setSelectedTask}
                  taskId={selectedTask.id}
                  isBookmarked={selectedTask.is_bookmarked}
                  token={effectiveToken}
                />
              </Suspense>
            </div>
          </div>
        ) : (
          <div className="flex flex-col md:flex-row justify-between items-start mb-6 space-y-4 md:space-y-0 md:items-center">
            <div className="flex items-center space-x-4 w-full md:w-auto justify-between">
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="cursor-pointer bg-white hover:bg-gray-100 text-gray-800 font-medium text-xs md:text-sm py-2 px-3 rounded-full shadow-md transition-colors duration-300 flex items-center">
                        <Upload className="w-3 h-3 md:w-4 md:h-4 inline-block mr-1 md:mr-2" />
                        Upload & Summarize
                        <ChevronDown className="w-3 h-3 md:w-4 md:h-4 ml-1 md:ml-2" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => document.getElementById('file-upload')?.click()}>
                        <Sheet className="w-3 h-3 md:w-4 md:h-4 mr-2" />
                        PDF
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => document.getElementById('file-upload-mp3')?.click()}>
                        <AudioWaveform className="w-3 h-3 md:w-4 md:h-4 mr-2" />
                        MP3
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setIsYouTubeModalOpen(true)}>
                        <Youtube className="w-3 h-3 md:w-4 md:h-4 mr-2" />
                        YouTube
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setIsWebsiteModalOpen(true)}>
                        <Webhook className="w-3 h-3 md:w-4 md:h-4 mr-2" />
                        Website
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <input
                    id="file-upload"
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept="application/pdf"
                  />
                  <input
                    id="file-upload-mp3"
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept="audio/mp3, audio/mpeg"
                  />
                  <div className="flex items-center space-x-2 bg-white rounded-full px-3 py-1 md:px-4 md:py-1.5 shadow-md">
                    <Label htmlFor="output-format-toggle" className="text-xs md:text-sm font-medium text-gray-700">
                      {showTranscript ? 'Transcript' : 'Notes'}
                    </Label>
                    <Switch
                      id="output-format-toggle"
                      checked={showTranscript}
                      onCheckedChange={() => setShowTranscript(!showTranscript)}
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleSaveTranscription}>
                        <Save className="w-4 h-4 mr-2" />
                        Save
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setIsLanguageModalOpen(true)}>
                        <Languages className="w-4 h-4 mr-2" />
                        Translate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleCombineTasks}>
                        <Combine className="w-4 h-4 mr-2" />
                        Merge Tasks
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleSummarizeAI} disabled={selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS}>                    
                        <Bot className="w-4 h-4 mr-2" />                                                                                                                 
                        {selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS ? 'Summarizing...' : 'Summarize'}                                         
                      </DropdownMenuItem>  
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <LayoutGroup>
                <AnimatePresence mode="wait">
                  {!isRecording ? (
                    <motion.div
                      key="record-button"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Button
                        className="w-full md:w-auto bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-normal py-1.5 px-3 md:px-4 rounded-full shadow-lg transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-300"
                        onClick={handleRecordClick}
                      >
                        <Mic className="w-4 h-4 md:w-5 md:h-5 mr-2" />
                        Transcribe Voice
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="recording-interface"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      className="w-full md:w-[300px] flex items-center justify-between bg-white rounded-full py-1 px-3 md:px-4 shadow-lg"
                    >
                      <button
                        className="text-gray-600 text-xs md:text-sm font-normal; hover:text-red-500 transition-colors duration-200"
                        onClick={stopRecording}
                      >
                        Cancel
                      </button>
                      <div className="flex items-center rounded-full px-2 py-1 md:px-3">
                        <motion.div
                          className="w-1 h-1 md:w-2 md:h-2 rounded-full bg-red-500 mr-1 md:mr-2"
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 1, repeat: Infinity }}
                        />
                        <span className="text-gray-700 text-xs md:text-sm font-medium">{formatRecordingTime(recordingTime)}</span>
                      </div>
                      <button
                        className="bg-indigo-500 rounded-full p-1 md:p-2 hover:bg-indigo-600 transition-colors duration-200"
                        onClick={stopRecording}
                      >
                        <Square className="w-3 h-3 md:w-4 md:h-4 text-white" />
                      </button>
                      <button
                        className="text-indigo-600 text-xs md:text-sm font-normal; flex items-center hover:text-indigo-700 transition-colors duration-200"
                        onClick={stopRecording}
                      >
                        <Check className="w-3 h-3 md:w-4 md:h-4 mr-1" />
                        Done
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </LayoutGroup>
              <Button
                onClick={handleTranscribe}
                disabled={(!selectedTask.media) || selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS || !selectedTask.media?.name?.endsWith('.mp3')}
                className={`w-auto px-3 md:px-6 py-1.5 text-white rounded-full focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-opacity-50 flex items-center justify-center ${(selectedTask.media?.download_url) && selectedTask.transcription_status !== TranscriptionStatus.IN_PROGRESS
                    ? 'bg-teal-500 hover:bg-teal-600'
                    : 'bg-gray-400 cursor-not-allowed'
                  }`}
              >
                {selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 md:h-5 md:w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Transcribing
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    Transcribe
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:space-x-6">
          {
            !isMobile && (
              <div className="w-full md:w-1/4 flex flex-col mb-6 md:mb-0">
                {/* YouTube Player */}
                <AnimatePresence>
                  {selectedTask.media?.youtube_id && (
                    <Suspense fallback={<LoadingFallback />}>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <LazyYouTubePlayer
                          youtubeId={selectedTask.media.youtube_id}
                          onProgress={({ playedSeconds }) => setYoutubeCurrentTime(playedSeconds)}
                        />
                      </motion.div>
                    </Suspense>
                  )}
                </AnimatePresence>
                {/* Audio Player */}
                <AnimatePresence>
                  {selectedTask.media?.download_url?.includes('.mp3') && !selectedTask.media?.youtube_id && (
                    <Suspense fallback={<LoadingFallback />}>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <LazyAudioPlayer
                          downloadUrl={selectedTask.media.download_url}
                          name={selectedTask.media.name || ''}
                          isUploading={isUploading.some(item => item.taskId === selectedTask.id && item.status)}
                          uploadError={uploadError}
                          isPlaying={isPlaying}
                          currentTime={currentTime}
                          duration={duration}
                          playbackRate={playbackRate}
                          togglePlayPause={togglePlayPause}
                          handleSkip={handleSkip}
                          handlePlaybackRateChange={handlePlaybackRateChange}
                          handleRemoveFile={handleRemoveFile}
                          audioRef={audioRef}
                        />
                      </motion.div>
                    </Suspense>
                  )}
                </AnimatePresence>

                {/* Transcription Preview */}
                <Suspense fallback={<LoadingFallback />}>
                  <LazyTranscriptionPreview
                    transcriptionResult={selectedTask.transcription_result || selectedTask.content}
                    summary={selectedTask.summary}
                    task={selectedTask}
                    setSelectedTask={setSelectedTask}
                    taskId={selectedTask.id}
                    isBookmarked={selectedTask.is_bookmarked}
                    token={effectiveToken}
                  />
                </Suspense>
              </div>
            )
          }

          <div className="w-full md:w-3/4">
            <div className="mb-4">
              {showTranscript ? (
                <Suspense fallback={<div>Loading transcript...</div>}>
                  <LazyTranscriptDisplay
                    segments={parseTranscriptSegments(selectedTask.transcription_result)}
                    currentTime={selectedTask.media?.youtube_id ? youtubeCurrentTime : currentTime}
                    onSegmentClick={(time) => {
                      if (selectedTask.media?.youtube_id) {
                        // We can't directly control the YouTube player with this package,
                        // so we'll need to implement a different approach for seeking
                        console.log('Seeking to', time, 'seconds');
                      } else if (audioRef.current) {
                        audioRef.current.currentTime = time;
                      }
                    }}
                    audioRef={audioRef}
                    taskId={selectedTask.id}
                    token={effectiveToken}
                    onTranscriptionUpdate={(updatedTranscription) => {
                      setSelectedTask({
                        ...selectedTask,
                        transcription_result: updatedTranscription
                      });
                    }}
                  />
                </Suspense>
              ) : selectedTask.content ? (
                quillLoaded && (
                  <Suspense fallback={<div>Loading notes...</div>}>
                    <LazyReactQuill
                      theme="snow"
                      value={editedTranscription}
                      onChange={(content) => {
                        debouncedHandleEditTranscription(content, selectedTask.id);
                      }}
                      className="react-quill-custom"
                      modules={{
                        toolbar: [
                          [{ 'header': [1, 2, false] }],
                          ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                          [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
                          ['link', 'image'],
                          ['clean']
                        ],
                        clipboard: {
                          matchVisual: false,
                        },
                      }}
                      formats={[
                        'header',
                        'bold', 'italic', 'underline', 'strike', 'blockquote',
                        'list', 'bullet', 'indent',
                        'link', 'image'
                      ]}
                    />
                  </Suspense>
                )
              ) : (
                <div className="h-[470px] bg-blue-50 border border-blue-200 rounded-lg p-6 text-blue-700">
                  <h3 className="text-lg font-normal; mb-4">How to Get Started</h3>
                  <ul className="list-disc pl-5 space-y-2">
                    <li>Upload an audio file (MP3 or WAV) less than 25MB</li>
                    <li>Click the "Transcribe" button to start the transcription process</li>
                    <li>Once transcribed, you can edit and save the content</li>
                    <li>Pro users can also transcribe YouTube videos</li>
                    <li>New feature coming soon - Summarize PDF</li>
                  </ul>
                  <p className="mt-4 text-sm">
                    Need help? <a href="mailto:scott@parodybiz.co.uk" className="text-blue-600 hover:text-blue-800 underline">Contact our support team</a> for assistance.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end space-x-0 md:space-x-4 mt-4 mb-8 md:mb-0">
              {isMobile && (
                <>
                  <Button 
                    onClick={handleCombineTasks}
                    className="w-full md:w-auto mb-2 bg-purple-500 hover:bg-purple-600 text-white"
                  >
                    <Layers className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    Merge Tasks
                  </Button>
                  <Button 
                    onClick={handleSaveTranscription}
                    className="w-full md:w-auto mb-2 md:mb-0 bg-teal-500 hover:bg-teal-600 text-white mr-2"
                    disabled={isSaving}
                  >
                    <Save className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                </>
              )}
              {!showTranscript && (
                <Button 
                  onClick={handleSummarizeAI} 
                  disabled={selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS}
                  className={`flex md:hidden w-full md:w-auto mb-2 bg-indigo-500 hover:bg-indigo-600 text-white ${selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Bot className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                  {selectedTask.transcription_status === TranscriptionStatus.IN_PROGRESS ? 'Summarizing...' : 'Summarize'}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="w-full md:w-auto mb-2 md:mb-0 bg-blue-500 hover:bg-blue-600 text-white">
                    <FileDown className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    Download
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleSaveAsFile('srt')}>
                    Transcript
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSaveAsFile('markdown')}>
                    Summary
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
      {showUpgradeModal && <UpgradeModal setShowUpgradeModal={setShowUpgradeModal} />}
      {isMobile && (
        <>
          <button
            onClick={handleRecordClick}
            className="fixed bottom-4 right-4 bg-indigo-600 text-white rounded-full p-4 shadow-lg hover:bg-indigo-700 transition-colors duration-200 z-50"
          >
            <Mic className="w-6 h-6" />
          </button>
          <AnimatePresence>
            {isRecording && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="fixed inset-0 z-40 flex items-center justify-center"
              >
                <div className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm" onClick={handleRecordClick}></div>
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="w-[300px] flex items-center justify-between bg-white rounded-full py-3 px-4 shadow-lg relative"
                >
                  <button 
                    className="text-gray-600 text-sm font-normal; hover:text-red-500 transition-colors duration-200" 
                    onClick={handleRecordClick}
                  >
                    Cancel
                  </button>
                  <div className="flex items-center rounded-full px-3 py-1">
                    <div className="w-2 h-2 rounded-full bg-red-500 mr-2 animate-pulse"></div>
                    <span className="text-gray-700 text-sm font-medium">{formatRecordingTime(recordingTime)}</span>
                  </div>
                  <button 
                    className="bg-indigo-500 rounded-full p-2 hover:bg-indigo-600 transition-colors duration-200"
                    onClick={handlePauseRecording}
                  >
                    {isPaused ? (
                      <Play className="w-4 h-4 text-white" />
                    ) : (
                      <Pause className="w-4 h-4 text-white" />
                    )}
                  </button>
                  <button 
                    className="text-indigo-600 text-sm font-normal; flex items-center hover:text-indigo-700 transition-colors duration-200"
                    onClick={handleRecordClick}
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Done
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      <Dialog open={isYouTubeModalOpen} onOpenChange={setIsYouTubeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter YouTube URL</DialogTitle>
          </DialogHeader>
          <Input
            type="text"
            inputMode="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={youTubeUrl}
            onChange={(e) => setYouTubeUrl(e.target.value)}
          />
          <DialogFooter>
            <Button onClick={() => setIsYouTubeModalOpen(false)}>Cancel</Button>
            <Button onClick={handleYouTubeTranscribe}>Transcribe</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isWebsiteModalOpen} onOpenChange={setIsWebsiteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Website URL</DialogTitle>
          </DialogHeader>
          <Input
            type="text"
            inputMode="url"
            placeholder="https://example.com"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
          <DialogFooter>
            <Button onClick={() => setIsWebsiteModalOpen(false)}>Cancel</Button>
            <Button onClick={handleWebsite}>Scrape and Summarize</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CombineTasksModal
        isOpen={isCombineModalOpen}
        onClose={() => setIsCombineModalOpen(false)}
        tasks={tasks || []}
        onCombineTasks={onCombineTasks}
      />

      <Dialog open={isLanguageModalOpen} onOpenChange={setIsLanguageModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose Language for Translation</DialogTitle>
          </DialogHeader>
          <Select onValueChange={setSelectedLanguage}>
            <SelectTrigger>
              <SelectValue placeholder="Select a language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="English">English</SelectItem>
              <SelectItem value="Spanish">Spanish</SelectItem>
              <SelectItem value="French">French</SelectItem>
              <SelectItem value="German">German</SelectItem>
              <SelectItem value="Italian">Italian</SelectItem>
              <SelectItem value="Portuguese">Portuguese</SelectItem>
              <SelectItem value="Russian">Russian</SelectItem>
              <SelectItem value="Japanese">Japanese</SelectItem>
              <SelectItem value="Korean">Korean</SelectItem>
              <SelectItem value="Chinese">Chinese</SelectItem>
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button onClick={() => setIsLanguageModalOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              setIsLanguageModalOpen(false);
              handleSummarizeAI();
            }}>Translate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </div>
      </ErrorBoundary>
      </Suspense>
  );
}

export default AudioTranscribe;
