//! `mushaf`: what agents' hooks run, and a way to open the Mushaf from a terminal.

fn main() -> std::process::ExitCode {
    mushaf_cli::run(
        &mushaf_protocol::MUSHAF,
        "the Madinah Mushaf, opened while your coding agent works",
        "Show the Mushaf: a page (50), an ayah (2:255) or a surah (البقرة)",
        env!("CARGO_PKG_VERSION"),
    )
}
