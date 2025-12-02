class VideoAPI {
  constructor(bearerToken) {
    this.bearerToken = bearerToken;
    this.baseURL = 'https://aisandbox-pa.googleapis.com/v1/video';
    this.headers = {
      'accept': '*/*',
      'accept-language': 'id,en-US;q=0.9,en;q=0.8',
      'authorization': bearerToken,

      'origin': 'https://labs.google',
      'priority': 'u=1, i',
      'referer': 'https://labs.google/',
      'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'x-browser-channel': 'stable',
      'x-browser-copyright': 'Copyright 2025 Google LLC. All Rights reserved.',
      'x-browser-validation': 'Aj9fzfu+SaGLBY9Oqr3S7RokOtM=',
      'x-browser-year': '2025',
      'x-client-data': 'CIy2yQEIpLbJAQipncoBCKvhygEIlqHLAQiFoM0BCPOYzwEI4p3PAQ==',
      'content-type': 'text/plain;charset=UTF-8'
    };
  }


  // Generate unique scene ID
  generateSceneId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Get model configuration based on aspect ratio, video type, and model variant
  getModelConfig(aspectRatio, isImageToVideo = false, modelVariant = 'veo-3-fast') {
    const configs = {
      'LANDSCAPE 16:9': {
        aspectRatio: 'VIDEO_ASPECT_RATIO_LANDSCAPE',
        // 3.1 Fast
        textToVideoFast: 'veo_3_1_t2v_fast_ultra',
        // 3.1 Fast [Lower Priority]
        textToVideoFastLow: 'veo_3_1_t2v_fast_ultra_relaxed',
        // 3.1 Quality
        textToVideoQuality: 'veo_3_1_t2v',
        imageToVideoFast: 'veo_3_0_r2v_fast_ultra',
        imageToVideoQuality: 'veo_3_0_r2v_fast_ultra'
      },


      'PORTRAIT 9:16': {
        aspectRatio: 'VIDEO_ASPECT_RATIO_PORTRAIT',
        textToVideoFast: 'veo_3_0_t2v_fast_portrait_ultra',
        textToVideoFastLow: 'veo_3_1_t2v_fast_portrait_ultra_relaxed',
        textToVideoQuality: 'veo_3_0_t2v_fast_portrait_ultra',
        imageToVideoFast: 'veo_3_0_r2v_fast_portrait_ultra',
        imageToVideoQuality: 'veo_3_0_r2v_fast_portrait_ultra'
      }
    };

    const config = configs[aspectRatio];
    if (!config) {
      throw new Error(`Unsupported aspect ratio: ${aspectRatio}`);
    }

    const useQuality = modelVariant === 'veo-3';
    const useFastLow = modelVariant === 'veo-3-fast-low';
    let videoModelKey;

    if (isImageToVideo) {
      videoModelKey = useQuality ? config.imageToVideoQuality : config.imageToVideoFast;
    } else {
      if (useFastLow && config.textToVideoFastLow) {
        videoModelKey = config.textToVideoFastLow;
      } else {
        videoModelKey = useQuality ? config.textToVideoQuality : config.textToVideoFast;
      }
    }

    return {
      aspectRatio: config.aspectRatio,
      videoModelKey
    };
  }

  // Text-to-Video generation
  async generateTextToVideo(prompt, aspectRatio = 'LANDSCAPE 16:9', seed = null, modelVariant = 'veo-3-fast') {
    try {
      const modelConfig = this.getModelConfig(aspectRatio, false, modelVariant);
      const sceneId = this.generateSceneId();
      const sessionId = `autoflow-${Date.now()}`;
      
      const requestBody = {
        clientContext: {
          sessionId: sessionId,
          projectId: "39e9deb0-db07-49a5-8071-076ef25c8ecd",
          tool: "PINHOLE",
          userPaygateTier: "PAYGATE_TIER_TWO"
        },

        requests: [{
          aspectRatio: modelConfig.aspectRatio,
          seed: seed || Math.floor(Math.random() * 100000),
          textInput: {
            prompt: prompt.replace(/"/g, '')
          },
          videoModelKey: modelConfig.videoModelKey,
          metadata: {
            sceneId: sceneId
          }
        }]
      };

      const response = await fetch(`${this.baseURL}:batchAsyncGenerateVideoText`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errorDetails = '';
        try {
          const errorText = await response.text();
          if (errorText) {
            errorDetails = ` | body: ${errorText.substring(0, 500)}`;
          }
        } catch (e) {}
        const err = new Error(`HTTP error! status: ${response.status}${errorDetails}`);
        err.status = response.status;
        throw err;
      }

      const result = await response.json();
      const remainingCredits =
        result && typeof result.remainingCredits === 'number'
          ? result.remainingCredits
          : null;

      return {
        success: true,
        data: result,
        sceneId: sceneId,
        operationName: result.operations?.[0]?.operation?.name,
        remainingCredits
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Image-to-Video generation (reference images)
  async generateImageToVideo(imageMediaId, prompt = "best camera movement base on picture", aspectRatio = 'LANDSCAPE 16:9', seed = null, modelVariant = 'veo-3-fast') {
    try {
      const modelConfig = this.getModelConfig(aspectRatio, true, modelVariant);
      const sceneId = this.generateSceneId();
      const sessionId = `autoflow-${Date.now()}`;
      const effectiveSeed = seed || Math.floor(Math.random() * 100000);
      
      const requestBody = {
        clientContext: {
          sessionId: sessionId,
          projectId: "ea0ee376-fde2-4ac5-b4b5-b29f3a081ed3",
          tool: "PINHOLE",
          userPaygateTier: "PAYGATE_TIER_TWO"
        },
        requests: [{
          aspectRatio: modelConfig.aspectRatio,
          metadata: {
            sceneId: sceneId
          },
          referenceImages: [{
            imageUsageType: "IMAGE_USAGE_TYPE_ASSET",
            mediaId: imageMediaId
          }],
          seed: effectiveSeed,
          textInput: {
            prompt: (prompt || '').replace(/"/g, '')
          },
          videoModelKey: modelConfig.videoModelKey
        }]
      };

      const response = await fetch(`${this.baseURL}:batchAsyncGenerateVideoReferenceImages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errorDetails = '';
        try {
          const errorText = await response.text();
          if (errorText) {
            errorDetails = ` | body: ${errorText.substring(0, 500)}`;
          }
        } catch (e) {}
        const err = new Error(`HTTP error! status: ${response.status}${errorDetails}`);
        err.status = response.status;
        throw err;
      }

      const result = await response.json();
      const remainingCredits =
        result && typeof result.remainingCredits === 'number'
          ? result.remainingCredits
          : null;

      return {
        success: true,
        data: result,
        sceneId: sceneId,
        operationName: result.operations?.[0]?.operation?.name,
        remainingCredits
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Check processing status
  async checkProcessingStatus(operationName, sceneId) {
    try {
      const requestBody = {
        operations: [{
          operation: {
            name: operationName
          },
          sceneId: sceneId,
          status: "MEDIA_GENERATION_STATUS_PENDING"
        }]
      };

      const response = await fetch(`${this.baseURL}:batchCheckAsyncVideoGenerationStatus`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errorDetails = '';
        try {
          const errorText = await response.text();
          if (errorText) {
            errorDetails = ` | body: ${errorText.substring(0, 500)}`;
          }
        } catch (e) {}
        const err = new Error(`HTTP error! status: ${response.status}${errorDetails}`);
        err.status = response.status;
        throw err;
      }

      const result = await response.json();
      const operation = result.operations?.[0];

      // Derive a simple status string for the polling logic in app.js
      let status = 'MEDIA_GENERATION_STATUS_PENDING';
      let videoUrl = null;

      if (operation?.operation?.metadata?.video?.fifeUrl) {
        // When video URL is available we consider it completed
        videoUrl = operation.operation.metadata.video.fifeUrl;
        status = 'MEDIA_GENERATION_STATUS_COMPLETED';
      } else if (operation?.operation?.metadata?.status) {
        // Fallback to any explicit status field from the metadata if present
        status = operation.operation.metadata.status;
      }

      return {
        success: true,
        completed: status === 'MEDIA_GENERATION_STATUS_COMPLETED',
        status,
        videoUrl,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Download video from URL
  async downloadVideo(videoUrl, outputPath) {
    try {
      const response = await fetch(videoUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      // Convert ArrayBuffer to Uint8Array for transfer to main process
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Use Electron's exposed file system API
      const result = await window.electronAPI.writeFile(outputPath, uint8Array);
      
      if (result.success) {
        return {
          success: true,
          filePath: result.filePath
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async uploadUserImage(imagePath, aspectRatio = 'LANDSCAPE 16:9') {
    try {
      if (!window.electronAPI || !window.electronAPI.readFileBase64) {
        throw new Error('readFileBase64 API is not available');
      }
      
      const fileResult = await window.electronAPI.readFileBase64(imagePath);
      if (!fileResult || !fileResult.success || !fileResult.base64) {
        const message = fileResult && fileResult.error ? fileResult.error : 'Failed to read image file';
        throw new Error(message);
      }
      
      const rawImageBytes = fileResult.base64;
      
      // Map UI aspect ratio to upload API aspect ratio
      let imageAspectRatio = 'IMAGE_ASPECT_RATIO_LANDSCAPE';
      if (aspectRatio === 'PORTRAIT 9:16') {
        imageAspectRatio = 'IMAGE_ASPECT_RATIO_PORTRAIT';
      }
      
      // Infer mime type from file extension (default to image/jpeg)
      let mimeType = 'image/jpeg';
      if (typeof imagePath === 'string') {
        const lower = imagePath.toLowerCase();
        if (lower.endsWith('.png')) mimeType = 'image/png';
        else if (lower.endsWith('.gif')) mimeType = 'image/gif';
        else if (lower.endsWith('.webp')) mimeType = 'image/webp';
        else if (lower.endsWith('.bmp')) mimeType = 'image/bmp';
        else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mimeType = 'image/jpeg';
      }
      
      const sessionId = `autoflow-${Date.now()}`;
      
      const requestBody = {
        imageInput: {
          rawImageBytes,
          mimeType,
          isUserUploaded: true,
          aspectRatio: imageAspectRatio
        },
        clientContext: {
          sessionId,
          tool: 'ASSET_MANAGER'
        }
      };
      
      const response = await fetch('https://aisandbox-pa.googleapis.com/v1:uploadUserImage', {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        let errorDetails = '';
        try {
          const errorText = await response.text();
          if (errorText) {
            errorDetails = ` | body: ${errorText.substring(0, 500)}`;
          }
        } catch (e) {}
        const err = new Error(`HTTP error! status: ${response.status}${errorDetails}`);
        err.status = response.status;
        throw err;
      }
      
      const result = await response.json();
      const mediaId = result.mediaGenerationId?.mediaGenerationId;
      if (!mediaId) {
        throw new Error('No mediaGenerationId returned from uploadUserImage');
      }
      
      return {
        success: true,
        mediaId,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Lightweight bearer token validation
  async testToken() {
    try {
      const requestBody = {
        operations: [{
          operation: {
            name: 'autoflow-token-test'
          },
          sceneId: 'autoflow-token-test-scene',
          status: 'MEDIA_GENERATION_STATUS_PENDING'
        }]
      };

      const response = await fetch(`${this.baseURL}:batchCheckAsyncVideoGenerationStatus`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          status: response.status,
          error: 'Unauthorized: bearer token is invalid or expired'
        };
      }

      return {
        success: true,
        status: response.status
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update bearer token
  updateBearerToken(newToken) {
    this.bearerToken = newToken;
    this.headers.authorization = newToken;
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoAPI;
} else {
  window.VideoAPI = VideoAPI;
}