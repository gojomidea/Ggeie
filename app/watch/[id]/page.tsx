import React from "react";
import styles from "./page.module.css";
import {
  MediaData,
  MediaDataFullInfo,
} from "../../ts/interfaces/anilistMediaData";
import { getEpisodeStreamingLinkFromGogoanime, getMediaEpisodesFromGogoanime } from "@/app/api/consumet/consumetGoGoAnime";
import anilist from "@/app/api/anilist/anilistMedias";
import * as MediaCardExpanded from "@/app/components/MediaCards/MediaInfoExpandedWithCover";
import {
  EpisodeLinksGoGoAnime,
  GogoanimeMediaEpisodes,
} from "@/app/ts/interfaces/gogoanimeData";
import EpisodesListContainer from "./components/EpisodesListContainer";
import CommentsSection from "@/app/components/CommentsSection";
import VideoPlayer from "./components/VideoPlayer";
import {
  EpisodeAniwatch,
  EpisodeLinksAniwatch,
} from "@/app/ts/interfaces/aniwatchData";
import { ImdbEpisode, ImdbMediaInfo } from "@/app/ts/interfaces/imdb";
import { getMediaInfoOnIMDB } from "@/app/api/consumet/consumetImdb";
import { SourceType } from "@/app/ts/interfaces/episodesSource";
import { FetchEpisodeError } from "@/app/components/MediaFetchErrorPage";
import { cookies } from "next/headers";
import { AlertWrongMediaVideoOnMediaId } from "./components/AlertContainer";
import {
  getEpisodeLinkFromAniwatch,
  getFromAniwatchOnlyThisData,
} from "@/app/api/aniwatch/aniwatch";

export const revalidate = 900; // revalidate cached data every 15 minutes

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { id: number }; // ANILIST ANIME ID
  searchParams: { episode: string; dub?: string }; // EPISODE NUMBER, DUBBED
}) {
  const accessTokenCookie = cookies().get("access_token")?.value;

  const userAuthorization = accessTokenCookie
    ? JSON.parse(accessTokenCookie).accessToken
    : undefined;

  const mediaInfo = (await anilist.getMediaInfo({
    id: params.id,
    accessToken: userAuthorization,
  })) as MediaData;

  let pageTitle = "";

  if (mediaInfo.format == "MOVIE") {
    pageTitle = `Watch ${mediaInfo.title.userPreferred} | AniProject`;
  } else {
    // ACTES AS DEFAULT VALUE FOR PAGE PROPS
    if (Object.keys(searchParams).length === 0) searchParams = { episode: "1" };

    pageTitle = `Episode ${searchParams.episode} - ${mediaInfo.title.userPreferred} | AniProject`;
  }

  return {
    title: mediaInfo ? pageTitle : "Error | AniProject",
    description: !mediaInfo
      ? ""
      : `Watch ${mediaInfo.title.userPreferred}${
          mediaInfo.format != "MOVIE"
            ? ` - episode ${searchParams.episode} `
            : ""
        }${searchParams.dub ? "Dubbed" : ""}. ${
          mediaInfo.description
            ? mediaInfo.description.replace(/(<([^>]+)>)/gi, "")
            : ""
        }`,
  };
}

export default async function WatchEpisode({
  params,
  searchParams,
}: {
  params: { id: number }; // ANILIST ANIME ID
  searchParams: {
    episode: string;
    source: SourceType["source"];
    q: string;
    t: string;
    dub?: string;
    alert?: string;
  }; // EPISODE NUMBER, SOURCE, EPISODE ID, TIME LAST STOP, DUBBED
}) {
  const accessTokenCookie = cookies().get("access_token")?.value;

  const userAuthorization = accessTokenCookie
    ? JSON.parse(accessTokenCookie).accessToken
    : undefined;

  const mediaInfo = (await anilist.getMediaInfo({
    id: params.id,
    accessToken: userAuthorization,
  })) as MediaDataFullInfo;

  // ACTES AS DEFAULT VALUE FOR PAGE PROPS
  if (Object.keys(searchParams).length === 0)
    searchParams = { episode: "1", source: "aniwatch", q: "", t: "0" };

  let hadFetchError = false;
  let videoIdDoesntMatch = false;

  if (!mediaInfo) hadFetchError = true;

  if (hadFetchError)
    return (
      <FetchEpisodeError mediaId={params.id} searchParams={searchParams} />
    );

  let episodeDataFetched: EpisodeLinksGoGoAnime | EpisodeLinksAniwatch | null =
    null;
  let episodeSubtitles: EpisodeLinksAniwatch["tracks"] | undefined = undefined;
  const subtitleLanguage =
    cookies().get("subtitle_language")?.value || "English";
  let episodesList: EpisodeAniwatch[] | GogoanimeMediaEpisodes[] = [];
  let videoUrlSrc: string | undefined = undefined;
  let imdbEpisodeInfo: ImdbEpisode | undefined;
  const imdbEpisodesList: ImdbEpisode[] = [];

  const loadImdbMediaAndEpisodeInfo = async () => {
    const imdbMediaInfo: ImdbMediaInfo = (await getMediaInfoOnIMDB({
      search: true,
      seachTitle: mediaInfo.title.english || mediaInfo.title.romaji,
      releaseYear: mediaInfo.startDate.year,
    })) as ImdbMediaInfo;

    // get episodes on imdb
    imdbMediaInfo?.seasons?.map((itemA) =>
      itemA.episodes?.map((itemB) => imdbEpisodesList.push(itemB))
    );

    imdbEpisodeInfo = imdbEpisodesList?.find(
      (item) => item.episode == Number(searchParams.episode)
    );
  };

  async function getGogoanimeStreamingLink() {
    episodeDataFetched = (await getEpisodeStreamingLinkFromGogoanime({
      episodeId: searchParams.q,
      useAlternateLinkOption: true,
    })) as EpisodeLinksGoGoAnime;

    if (!episodeDataFetched) {
      hadFetchError = true;

      return;
    }

    // Episode link source
    videoUrlSrc = episodeDataFetched.sources.find(
      (item) => item.quality == "default"
    ).url;
    if (!videoUrlSrc) videoUrlSrc = episodeDataFetched.sources[0].url;

    // Episodes for this media
    episodesList = (await getMediaEpisodesFromGogoanime({
      mediaTitle: mediaInfo.title.english || mediaInfo.title.romaji,
      onlyDubEpisodes: searchParams.dub == "true",
    })) as GogoanimeMediaEpisodes[];

    videoIdDoesntMatch = compareEpisodeIDs(episodesList, "gogoanime");
  }

  async function getAniwatchStreamingLink() {
    if (!searchParams.q) {
      episodesList = (await getFromAniwatchOnlyThisData({
        mediaTitle: mediaInfo.title.english || mediaInfo.title.romaji,
        typeOfDataWanted: "episodes",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).then((res: any) => res?.episodes)) as EpisodeAniwatch[];

      searchParams.q = episodesList[0].episodeId;
    }

    // fetch episode data
    episodeDataFetched = (await getEpisodeLinkFromAniwatch({
      episodeId: searchParams.q,
      category: searchParams.dub == "true" ? "dub" : "sub",
    })) as EpisodeLinksAniwatch;

    if (!episodeDataFetched) hadFetchError = true;

    // fetch episode link source
    videoUrlSrc = episodeDataFetched.sources[0].url;

    // fetch episodes for this media
    if (episodesList.length == 0) {
      episodesList = (await getFromAniwatchOnlyThisData({
        mediaTitle: mediaInfo.title.english || mediaInfo.title.romaji,
        typeOfDataWanted: "episodes",
        mediaFormat: mediaInfo.format,
        mediaId: searchParams?.q?.split("?")[0],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).then((res: any) =>
        searchParams?.dub == "true"
          ? res?.episodes.slice(0, res.episodesDub)
          : res?.episodes
      )) as EpisodeAniwatch[];
    }

    episodeSubtitles = episodeDataFetched.tracks;

    videoIdDoesntMatch = compareEpisodeIDs(episodesList, "aniwatch");
  }

  const getVideoStreamingLinkFromSource = async () => {
    switch (searchParams.source) {
      case "gogoanime":
        await getGogoanimeStreamingLink();

        break;

      case "aniwatch":
        await getAniwatchStreamingLink();

        break;

      default:
        hadFetchError = true;
    }
  };

  await Promise.all([
    loadImdbMediaAndEpisodeInfo(),
    getVideoStreamingLinkFromSource(),
  ]);

  function compareEpisodeIDs(
    episodesList: { id?: string; episodeId?: string }[],
    sourceName: SourceType["source"]
  ) {
    // Compare Episode ID from params with episodes fetched ID
    switch (sourceName) {
      case "aniwatch":
        const aniwatchEpisodeIdFromParamsIsOnEpisodesList = episodesList.find(
          (episode) => episode.episodeId == searchParams.q
        );

        return aniwatchEpisodeIdFromParamsIsOnEpisodesList == undefined;

      case "gogoanime":
        const gogoanimeEpisodeIdFromParamsIsOnEpisodesList = episodesList.find(
          (episode) => episode.id == searchParams.q
        );

        return gogoanimeEpisodeIdFromParamsIsOnEpisodesList == undefined;

      default:
        return false;
    }
  }

  const episodeTitle = () => {
    if (searchParams.source == "gogoanime") {
      return (
        imdbEpisodesList[Number(searchParams.episode) - 1]?.title ||
        imdbEpisodeInfo?.title ||
        mediaInfo.title.userPreferred ||
        mediaInfo.title.romaji
      );
    } else {
      return (episodesList[Number(searchParams.episode) - 1] as EpisodeAniwatch)
        ?.title;
    }
  };

  if (
    hadFetchError ||
    videoUrlSrc == undefined ||
    episodeDataFetched == undefined
  ) {
    return (
      <FetchEpisodeError mediaId={params.id} searchParams={searchParams} />
    );
  }

  if (videoIdDoesntMatch && searchParams?.alert == "true") {
    return (
      <AlertWrongMediaVideoOnMediaId
        mediaId={params.id}
        mediaTitle={mediaInfo.title.userPreferred}
        mediaFormat={mediaInfo.format}
      />
    );
  }

  return (
    <main id={styles.container}>
      {/* PLAYER */}
      <div className={styles.background}>
        <section id={styles.video_container}>
          <VideoPlayer
            mediaEpisodes={episodesList}
            mediaSource={searchParams.source}
            mediaInfo={mediaInfo}
            videoInfo={{
              urlSource: videoUrlSrc,
              subtitleLang: subtitleLanguage,
              subtitlesList: episodeSubtitles,
              currentLastStop: searchParams.t || undefined,
              videoQualities: undefined,
              // videoQualities: searchParams.source == "gogoanime" ? (episodeData as EpisodeLinksGoGoAnime).sources : undefined
            }}
            episodeInfo={{
              episodeId: searchParams.q,
              episodeIntro:
                searchParams.source == "aniwatch"
                  ? (episodeDataFetched as EpisodeLinksAniwatch).intro
                  : undefined,
              episodeOutro: (episodeDataFetched as EpisodeLinksAniwatch)?.outro,
              episodeNumber: searchParams.episode,
              episodeImg:
                imdbEpisodesList[Number(searchParams.episode) - 1]?.img?.hd ||
                mediaInfo.bannerImage ||
                null,
            }}
          />
        </section>
      </div>

      <section id={styles.media_info_container}>
        <div id={styles.info_comments}>
          <div id={styles.heading_info_container}>
            <h1 className="display_flex_row align_items_center">
              {mediaInfo.format == "MOVIE" ? (
                mediaInfo.title.userPreferred
              ) : (
                <React.Fragment>
                  EP {searchParams.episode}
                  <span>{" - "}</span>
                  <span>{episodeTitle()}</span>
                </React.Fragment>
              )}
            </h1>

            {videoIdDoesntMatch && (
              <small id={styles.alert_wrong_media}>
                This video {`doesn't`} belong to this media
              </small>
            )}

            <MediaCardExpanded.Container mediaInfo={mediaInfo as MediaData}>
              <p>
                <MediaCardExpanded.Description
                  description={
                    imdbEpisodeInfo?.description || mediaInfo.description
                  }
                />
              </p>
            </MediaCardExpanded.Container>
          </div>

          <div className={styles.only_desktop}>
            <div className={styles.comment_container}>
              <h2>
                COMMENTS{" "}
                {mediaInfo.format != "MOVIE" &&
                  `FOR EPISODE ${searchParams.episode}`}
              </h2>

              {/* ONLY ON DESKTOP */}
              <CommentsSection
                mediaInfo={mediaInfo}
                isOnWatchPage={true}
                episodeId={searchParams.q}
                episodeNumber={Number(searchParams.episode)}
              />
            </div>
          </div>
        </div>

        <div data-format={mediaInfo.format}>
          {mediaInfo.format != "MOVIE" && (
            <EpisodesListContainer
              sourceName={searchParams.source}
              anilistLastEpisodeWatched={
                mediaInfo.mediaListEntry?.progress || undefined
              }
              episodesList={episodesList}
              nextAiringEpisodeInfo={mediaInfo.nextAiringEpisode}
              episodesListOnImdb={
                imdbEpisodesList.length > 0 ? imdbEpisodesList : undefined
              }
              mediaId={params.id}
              activeEpisodeNumber={Number(searchParams.episode)}
            />
          )}

          {/* ONLY ON MOBILE */}
          <div className={styles.only_mobile}>
            <div className={styles.comment_container}>
              <h2>
                COMMENTS{" "}
                {mediaInfo.format != "MOVIE" &&
                  `FOR EPISODE ${searchParams.episode}`}
              </h2>

              <CommentsSection
                mediaInfo={mediaInfo}
                isOnWatchPage={true}
                episodeId={searchParams.q}
                episodeNumber={Number(searchParams.episode)}
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
