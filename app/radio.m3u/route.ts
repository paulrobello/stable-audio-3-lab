import { NextRequest } from "next/server";
import { buildRadioPlaylistRouteResponse } from "@/lib/radio-playlist-response";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return buildRadioPlaylistRouteResponse("m3u", request);
}
