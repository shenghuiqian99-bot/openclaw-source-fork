import {
  describeImageWithModel,
  describeImagesWithModel,
  type MediaUnderstandingProvider,
} from "openclaw/plugin-sdk/media-understanding";
import { describeMinimaxVideo } from "./video-understanding.js";

export const minimaxMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "minimax",
  capabilities: ["image", "video"],
  describeImage: describeImageWithModel,
  describeImages: describeImagesWithModel,
  describeVideo: describeMinimaxVideo,
};

export const minimaxPortalMediaUnderstandingProvider: MediaUnderstandingProvider = {
  id: "minimax-portal",
  capabilities: ["image", "video"],
  describeImage: describeImageWithModel,
  describeImages: describeImagesWithModel,
  describeVideo: describeMinimaxVideo,
};
