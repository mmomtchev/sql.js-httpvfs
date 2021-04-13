import { observer, useLocalObservable } from "mobx-react";
import * as React from "react";
import { Database } from "sql.js";
import {
  authorsSearch,
  createDbWorker,
  getForAuthor,
  SponsorInfo,
  SqliteWorker,
  VideoMeta,
} from "./db";
import { action, makeAutoObservable, makeObservable, observable } from "mobx";
import AsyncSelect from "react-select/async";
import debounce from "debounce-promise";
import Plot from "react-plotly.js";
function formatDuration(sec_num: number) {
  const hours = Math.floor(sec_num / 3600);
  const minutes = Math.floor((sec_num - hours * 3600) / 60);
  const seconds = Math.round(sec_num - hours * 3600 - minutes * 60);

  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0")
  );
}
const SponsorPlot: React.FC<{
  data: SponsorInfo[];
  onHover: (m: SponsorInfo) => void;
}> = observer((p) => {
  console.log("RERENTDERING PLOT");
  return (
    <Plot
      style={{ width: "100%", maxWidth: "1200px", margin: "0 auto" }}
      onClick={(e) => {
        console.log("hover", e);
        const element = p.data[e.points[0].pointIndex];
        if (element) p.onHover(element);
      }}
      data={[
        {
          x: p.data.map((e) => new Date(e.meta.published * 1000)),
          y: p.data.map((e) => e.percentSponsor / 100),

          text: p.data.map(
            (e) =>
              `<b>${e.meta.title}</b><br>
              published ${new Date(
                e.meta.published * 1000
              ).toLocaleDateString()}<br>
              Length: ${formatDuration(e.meta.lengthSeconds)}<br>
              Sponsor duration: ${formatDuration(
                e.durationSponsor
              )} (<b>${e.percentSponsor.toFixed(0)}%</b>)`
          ),
          hovertemplate: "%{text}",
          type: "scatter",
          mode: "markers",
        },
      ]}
      layout={{
        autosize: true,
        yaxis: { tickformat: ",.0%", title: "Part that is Sponsorship" },
        xaxis: { title: "Upload date" },
      }}
    />
  );
});

type SqliteStats = {
  filename: string;
  totalBytes: number;
  totalFetchedBytes: number;
  totalRequests: number;
};
function formatBytes(b: number) {
  if (b > 1e6) {
    return (b / 1e6).toFixed(2) + "MB";
  }
  if (b > 1e3) {
    return (b / 1e3).toFixed(2) + "KB";
  }
  return b + "B";
}

const SqliteStats: React.FC<{ stats: SqliteStats }> = observer(({ stats }) => {
  return (
    <>
      Sqlite stats: fetched {formatBytes(stats.totalFetchedBytes)} in{" "}
      {stats.totalRequests} requests (DB size: {formatBytes(stats.totalBytes)})
    </>
  );
});

const VideoMetaDisplay: React.FC<{ video: SponsorInfo }> = observer(
  ({ video }) => {
    return (
      <div>
        <a href={`https://youtube.com/watch?v=${video.meta.videoID}`}>
          <img
            src={video.meta.maxresdefault_thumbnail}
            width={200}
            style={{ float: "left" }}
          ></img>
          <h4>{video.meta.title}</h4>
        </a>
        {video.meta.viewCount} views
        <br />
        published {new Date(video.meta.published * 1000).toLocaleDateString()}
        <br />
        Length: {formatDuration(video.meta.lengthSeconds)}
        <br />
        Sponsor duration: {formatDuration(video.durationSponsor)} (
        <b>{video.percentSponsor.toFixed(0)}%</b>)
      </div>
    );
  }
);

@observer
export class UI extends React.Component {
  worker: SqliteWorker | null = null;
  db: Database | null = null;
  @observable
  data:
    | { state: "noinput" }
    | { state: "loading"; author: string }
    | { state: "loaded"; author: string; segs: SponsorInfo[] } = {
    state: "noinput",
  };
  @observable
  stats: SqliteStats | null = null;
  @observable
  focussedVideo: SponsorInfo | null = null;
  @observable searchInput: string = "";

  constructor(p: {}) {
    super(p);
    this.init();
    makeObservable(this);
  }
  interval: number = 0;
  componentDidMount() {
    this.interval = setInterval(async () => {
      this.stats = (await this.worker?.getStats()) || null;
    }, 1000);
  }
  componentWillUnmount() {
    clearInterval(this.interval);
  }
  async init() {
    console.log("INIT");
    const res = await createDbWorker();
    this.db = res.db;
    this.worker = res.worker;
    const initialAuthor = new URLSearchParams(location.search).get("uploader");
    if (initialAuthor) this.setAuthor(initialAuthor);
  }
  async setAuthor(search: string) {
    this.searchInput = search;
    this.focussedVideo = null;
    if (this.db) {
      this.data = {
        state: "loading",
        author: search,
      };
      this.data = {
        state: "loaded",
        author: search,
        segs: await getForAuthor(this.db, search),
      };
      console.log("data", this.data);
      {
        const searchParams = new URLSearchParams(location.search);
        searchParams.set("uploader", search);
        window.history.replaceState(null, document.title, "?" + searchParams);
      }
    }
  }
  async authorsSearch(search: string) {
    if (this.db) {
      return await authorsSearch(this.db, search);
    }
    return [];
  }
  authorsSearchDebounce = debounce(this.authorsSearch.bind(this), 250, {
    leading: true,
  });
  @action
  setFocussed = (e: SponsorInfo) => (this.focussedVideo = e);

  render() {
    return (
      <div>
        <div>
          Search for YouTuber:{" "}
          <AsyncSelect<{ name: string }>
            cacheOptions
            inputValue={this.searchInput}
            onInputChange={(e) => (this.searchInput = e)}
            loadOptions={this.authorsSearchDebounce}
            getOptionLabel={(e) => e.name}
            getOptionValue={(e) => e.name}
            onChange={(e) => this.setAuthor(e.name)}
          />
        </div>
        {this.data.state === "noinput" ? (
          <></>
        ) : this.data.state === "loading" ? (
          <div>Loading videos for author "{this.data.author}"</div>
        ) : (
          <div>
            <p>
              Found {this.data.segs.length} videos with sponsorships from{" "}
              {this.data.author}
            </p>{" "}
            <SponsorPlot data={this.data.segs} onHover={this.setFocussed} />
          </div>
        )}
        {this.focussedVideo && <VideoMetaDisplay video={this.focussedVideo} />}
        <footer style={{ marginTop: "5em", color: "gray" }}>
          {this.stats ? <SqliteStats stats={this.stats} /> : ""}{" "}
        </footer>
      </div>
    );
  }
}
