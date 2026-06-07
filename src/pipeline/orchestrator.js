import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../utils/logger.js';
import { checkBudget, cleanupTempFiles } from '../utils/helpers.js';
import config from '../config/index.js';
import { insertVideo, updateVideo, markTopicUsed, getSupabase, dbRetry } from '../database/client.js';

// Import all modules
import { discoverTopics } from '../modules/trend-discovery/index.js';
import { scoreUnscoredTopics, selectBestTopic } from '../modules/topic-scoring/index.js';
import { generateHooks } from '../modules/hook-generator/index.js';
import { generateScript } from '../modules/script-generator/index.js';
import { breakdownScenes } from '../modules/scene-breakdown/index.js';
import { generateVisualPrompts } from '../modules/prompt-engine/index.js';
import { generateVisuals } from '../modules/visual-generator/index.js';
import { generateVoiceover } from '../modules/voiceover-generator/index.js';
import { generateSubtitles } from '../modules/subtitle-generator/index.js';
import { composeVideo } from '../modules/video-composer/index.js';
import { generateSEO } from '../modules/seo-generator/index.js';
import { generateThumbnail } from '../modules/thumbnail-generator/index.js';
import { uploadToYouTube, validateYouTubeAuth } from '../modules/youtube-uploader/index.js';

const logger = createModuleLogger('orchestrator');

// ============================================
// PIPELINE STEPS
// ============================================
const PIPELINE_STEPS = [
  'topic_selection',
  'hook_generation',
  'script_generation',
  'scene_breakdown',
  'prompt_engineering',
  'visual_generation',
  'voiceover_generation',
  'subtitle_generation',
  'video_composition',
  'seo_generation',
  'thumbnail_generation',
];

// ============================================
// FULL PIPELINE EXECUTION
// ============================================
export async function runFullPipeline(options = {}) {
  const startTime = Date.now();
  const pipelineId = uuidv4();
  const supabase = getSupabase();

  logger.info(`🚀 Pipeline started [${pipelineId}]`);

  // Create pipeline run record
  await dbRetry(() => supabase.from('pipeline_runs').insert({
    id: pipelineId,
    channel_id: config.channel.id,
    status: 'running',
    current_step: 'initializing',
    metadata: { options },
  }));

  let videoId = null;

  try {
    // ===== BUDGET CHECK =====
    const budget = await checkBudget();
    if (!budget.allowed) {
      throw new Error(`Daily budget exceeded. Spent: $${budget.spent}`);
    }
    logger.info(`Budget check: $${budget.remaining.toFixed(2)} remaining`);

    // ===== STEP 1: TOPIC DISCOVERY + SCORING =====
    await updatePipelineStep(supabase, pipelineId, 'topic_selection');
    logger.info('📡 Step 1: Discovering and scoring topics...');

    // Discover new topics if needed
    await discoverTopics();
    await scoreUnscoredTopics();

    // Select the best topic
    const topic = await selectBestTopic();
    logger.info(`✅ Topic selected: "${topic.title}" (score: ${topic.composite_score})`);

    // Create video record
    videoId = uuidv4();
    await insertVideo({
      id: videoId,
      topic_id: topic.id,
      channel_id: config.channel.id,
      hook: '',
      script: '',
      script_word_count: 0,
      scenes: [],
      status: 'draft',
      pipeline_step: 'topic_selection',
      topic_category: topic.category,
    });

    await dbRetry(() => supabase.from('pipeline_runs').update({ video_id: videoId }).eq('id', pipelineId));

    // ===== STEP 2: HOOK GENERATION =====
    await updatePipelineStep(supabase, pipelineId, 'hook_generation');
    logger.info('🪝 Step 2: Generating hooks...');

    const hookResult = await generateHooks(topic);
    await updateVideo(videoId, {
      hook: hookResult.selectedHook,
      pipeline_step: 'hook_generation',
    });

    logger.info(`✅ Hook: "${hookResult.selectedHook}"`);

    // ===== STEP 3: SCRIPT GENERATION =====
    await updatePipelineStep(supabase, pipelineId, 'script_generation');
    logger.info('📝 Step 3: Generating script...');

    const scriptResult = await generateScript(topic, hookResult.selectedHook);
    await updateVideo(videoId, {
      script: scriptResult.script,
      script_word_count: scriptResult.wordCount,
      status: 'scripted',
      pipeline_step: 'script_generation',
    });

    logger.info(`✅ Script: ${scriptResult.wordCount} words, ~${scriptResult.estimatedDuration}s`);

    // ===== STEP 4: SCENE BREAKDOWN =====
    await updatePipelineStep(supabase, pipelineId, 'scene_breakdown');
    logger.info('🎬 Step 4: Breaking down scenes...');

    const sceneResult = await breakdownScenes(scriptResult.script, topic);
    await updateVideo(videoId, {
      scenes: sceneResult.scenes,
      pipeline_step: 'scene_breakdown',
    });

    logger.info(`✅ Scenes: ${sceneResult.scenes.length} scenes, ~${sceneResult.totalDuration}s`);

    // ===== STEP 5: VISUAL PROMPT ENGINEERING =====
    await updatePipelineStep(supabase, pipelineId, 'prompt_engineering');
    logger.info('🎨 Step 5: Engineering visual prompts...');

    const visualPrompts = await generateVisualPrompts(sceneResult.scenes);
    await updateVideo(videoId, {
      visual_prompts: visualPrompts,
      pipeline_step: 'prompt_engineering',
    });

    logger.info(`✅ Visual prompts: ${visualPrompts.length} prompts generated`);

    // ===== STEP 6: VISUAL GENERATION =====
    await updatePipelineStep(supabase, pipelineId, 'visual_generation');
    logger.info('🖼️ Step 6: Generating visuals...');

    const imageUrls = await generateVisuals(visualPrompts, videoId, topic.category);
    await updateVideo(videoId, {
      image_urls: imageUrls,
      status: 'visualized',
      pipeline_step: 'visual_generation',
    });

    logger.info(`✅ Visuals: ${imageUrls.filter(u => u).length} images generated`);

    // ===== STEP 7: VOICEOVER GENERATION =====
    await updatePipelineStep(supabase, pipelineId, 'voiceover_generation');
    logger.info('🎙️ Step 7: Generating voiceover...');

    const voiceover = await generateVoiceover(scriptResult.script, videoId, topic.category);
    await updateVideo(videoId, {
      voiceover_url: voiceover.filePath,
      voiceover_duration: voiceover.duration,
      pipeline_step: 'voiceover_generation',
    });

    logger.info(`✅ Voiceover: ${voiceover.duration}s via ${voiceover.provider}`);

    // ===== STEP 8: SUBTITLE GENERATION =====
    await updatePipelineStep(supabase, pipelineId, 'subtitle_generation');
    logger.info('📑 Step 8: Generating subtitles...');

    const subtitles = await generateSubtitles(
      scriptResult.script,
      voiceover.duration,
      sceneResult.scenes,
      videoId
    );

    await updateVideo(videoId, {
      subtitle_file_url: subtitles.assPath,
      pipeline_step: 'subtitle_generation',
    });

    logger.info('✅ Subtitles generated (ASS format)');

    // ===== STEP 9: VIDEO COMPOSITION =====
    await updatePipelineStep(supabase, pipelineId, 'video_composition');
    logger.info('🎥 Step 9: Composing final video...');

    const validImages = imageUrls.filter(u => u !== null);
    const composedVideo = await composeVideo({
      images: validImages,
      scenes: sceneResult.scenes,
      voiceoverPath: voiceover.filePath,
      voiceoverDuration: voiceover.duration,
      subtitlePath: subtitles.assPath,
      videoId,
      mood: sceneResult.scenes[0]?.mood || 'dark',
    });

    await updateVideo(videoId, {
      final_video_url: composedVideo.filePath,
      final_video_duration: composedVideo.duration,
      file_size_mb: composedVideo.fileSizeMB,
      status: 'composed',
      pipeline_step: 'video_composition',
    });

    logger.info(`✅ Video composed: ${composedVideo.duration}s, ${composedVideo.fileSizeMB}MB`);

    // ===== STEP 10: SEO GENERATION =====
    await updatePipelineStep(supabase, pipelineId, 'seo_generation');
    logger.info('🔍 Step 10: Generating SEO metadata...');

    const seo = await generateSEO(scriptResult.script, topic, hookResult.selectedHook);
    await updateVideo(videoId, {
      seo_title: seo.title,
      seo_description: seo.description,
      seo_tags: seo.tags,
      seo_hashtags: seo.hashtags,
      pipeline_step: 'seo_generation',
    });

    logger.info(`✅ SEO: "${seo.title}"`);

    // ===== STEP 11: THUMBNAIL GENERATION =====
    await updatePipelineStep(supabase, pipelineId, 'thumbnail_generation');
    logger.info('🖼️ Step 11: Generating thumbnail...');

    const thumbnail = await generateThumbnail(composedVideo.filePath, videoId);
    await updateVideo(videoId, {
      thumbnail_url: thumbnail,
      pipeline_step: 'thumbnail_generation',
    });

    logger.info('✅ Thumbnail generated');

    // ===== MARK TOPIC AS USED =====
    await markTopicUsed(topic.id);

    // ===== COMPLETE =====
    const elapsed = (Date.now() - startTime) / 1000;

    await dbRetry(() => supabase.from('pipeline_runs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      duration_seconds: elapsed,
      steps_completed: PIPELINE_STEPS,
    }).eq('id', pipelineId));

    logger.info(`🎉 Pipeline complete in ${elapsed.toFixed(0)}s! Video ready: ${videoId}`);

    return {
      videoId,
      pipelineId,
      title: seo.title,
      duration: composedVideo.duration,
      filePath: composedVideo.filePath,
      elapsed,
      status: 'composed',
    };

  } catch (err) {
    const elapsed = (Date.now() - startTime) / 1000;
    logger.error(`❌ Pipeline failed at step: ${err.message}`, {
      pipelineId,
      videoId,
      elapsed,
      stack: err.stack,
    });

    // Update pipeline run
    await dbRetry(() => supabase.from('pipeline_runs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      duration_seconds: elapsed,
      error: err.message,
      error_stack: err.stack,
    }).eq('id', pipelineId));

    // Update video if it was created
    if (videoId) {
      await updateVideo(videoId, {
        status: 'failed',
        pipeline_errors: { message: err.message, step: 'unknown' },
      }).catch(() => {});
    }

    throw err;
  }
}

// ============================================
// UPLOAD PIPELINE (separate from creation)
// ============================================
export async function runUploadPipeline(videoId, scheduledTime) {
  logger.info(`📤 Upload pipeline started for ${videoId}`);

  const supabase = getSupabase();
  const { data: video, error } = await dbRetry(() => supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .single());

  if (error || !video) throw new Error(`Video ${videoId} not found`);
  if (video.status !== 'composed') throw new Error(`Video status is ${video.status}, not composed`);

  const result = await uploadToYouTube({
    videoId: video.id,
    filePath: video.final_video_url,
    title: video.seo_title,
    description: video.seo_description,
    tags: video.seo_tags,
    thumbnailPath: video.thumbnail_url,
    scheduledTime,
  });

  if (config.processing.cleanupTempAfterUpload) {
    await cleanupTempFiles(videoId);
  } else {
    logger.info(`Kept generated assets for inspection: ${config.processing.tempDir}/${videoId}`);
  }

  logger.info(`✅ Upload complete: ${result.youtubeUrl}`);
  return result;
}

// ============================================
// HELPERS
// ============================================
async function updatePipelineStep(supabase, pipelineId, step) {
  await dbRetry(() => supabase.from('pipeline_runs').update({
    current_step: step,
  }).eq('id', pipelineId));
}

// ============================================
// CLI ENTRY POINT
// ============================================
if (process.argv[1] && process.argv[1].includes('orchestrator')) {
  const singleMode = process.argv.includes('--single');
  const uploadImmediate = process.argv.includes('--upload');
  
  (async () => {
    try {
      const count = singleMode ? 1 : config.schedule.videosPerDay;
      logger.info(`Running pipeline for ${count} video(s)...`);

      if (uploadImmediate) {
        logger.info('Checking YouTube OAuth before generating video...');
        await validateYouTubeAuth();
        logger.info('YouTube OAuth check passed');
      }

      for (let i = 0; i < count; i++) {
        logger.info(`\n${'='.repeat(60)}\n📹 Video ${i + 1}/${count}\n${'='.repeat(60)}`);
        const result = await runFullPipeline();
        
        if (uploadImmediate && result && result.videoId) {
          logger.info(`📤 Uploading video ${result.videoId} immediately to YouTube...`);
          await runUploadPipeline(result.videoId, null);
          logger.info('✅ Immediate upload successful!');
        }
      }

      logger.info('All pipelines complete!');
      process.exit(0);
    } catch (err) {
      logger.error('Pipeline failed', { error: err.message });
      process.exit(1);
    }
  })();
}

export default { runFullPipeline, runUploadPipeline };
