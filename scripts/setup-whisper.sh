#!/usr/bin/env bash
# Builds the whisper.cpp HTTP server binary at a pinned tag.
#
# Upstream whisper.cpp publishes no prebuilt release binaries (the "assets"
# of a release are empty), so — like Hex, which bundles its own transcribe.cpp
# engine — we build the sidecar once and keep it in .whisper.cpp/ (gitignored).
#
# If cmake is missing, a portable Kitware build is installed to
# ~/.local/opt/cmake (no sudo needed).
#
# Result: .whisper.cpp/build/bin/whisper-server
# The dashboard's whisper setup card then installs a pinned model from
# Hugging Face and starts the server.
set -euo pipefail

WHISPER_TAG="v1.9.5"
WHISPER_DIR="${WHISPER_CPP_DIR:-.whisper.cpp}"
CMAKE_VERSION="4.5.0"

ensure_cmake() {
	if command -v cmake >/dev/null 2>&1; then
		CMAKE_BIN="cmake"
		return
	fi
	local portable="$HOME/.local/opt/cmake/bin/cmake"
	if [ -x "$portable" ]; then
		CMAKE_BIN="$portable"
		echo "→ using portable cmake at $portable"
		return
	fi

	echo "→ cmake not found; installing a portable copy to ~/.local/opt/cmake"
	case "$(uname -s)-$(uname -m)" in
		Linux-x86_64) local arch="x86_64" ;;
		Linux-aarch64 | Linux-arm64) local arch="aarch64" ;;
		*)
			echo "✗ no portable cmake for $(uname -s)-$(uname -m) — install cmake manually (e.g. brew install cmake)" >&2
			exit 1
			;;
	esac
	local url="https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-${arch}.tar.gz"
	mkdir -p "$HOME/.local/opt"
	curl -sL -o "${TMPDIR:-/tmp}/cmake.tar.gz" "$url"
	tar xzf "${TMPDIR:-/tmp}/cmake.tar.gz" -C "$HOME/.local/opt/"
	rm -rf "$HOME/.local/opt/cmake"
	mv "$HOME/.local/opt/cmake-${CMAKE_VERSION}-linux-${arch}" "$HOME/.local/opt/cmake"
	rm -f "${TMPDIR:-/tmp}/cmake.tar.gz"
	CMAKE_BIN="$HOME/.local/opt/cmake/bin/cmake"
	echo "→ portable cmake installed: $CMAKE_BIN"
}

ensure_cmake

if [ ! -d "$WHISPER_DIR" ]; then
	echo "→ cloning whisper.cpp at $WHISPER_TAG"
	git clone --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
else
	echo "→ reusing existing checkout at $WHISPER_DIR (expecting $WHISPER_TAG)"
fi

JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

echo "→ configuring (native CPU optimizations)"
"$CMAKE_BIN" -B "$WHISPER_DIR/build" -S "$WHISPER_DIR" -DGGML_NATIVE=ON -DGGML_CCACHE=OFF -DBUILD_SHARED_LIBS=OFF

echo "→ building whisper-server + parakeet-cli ($JOBS jobs)"
"$CMAKE_BIN" --build "$WHISPER_DIR/build" --target whisper-server parakeet-cli -j "$JOBS"

echo
echo "✓ binaries ready:"
echo "  $WHISPER_DIR/build/bin/whisper-server   (HTTP sidecar for whisper models)"
echo "  $WHISPER_DIR/build/bin/parakeet-cli     (runner for parakeet models, e.g. parakeet-v3)"
echo "  next: install a model from the dashboard's whisper setup card"
echo "  (ffmpeg must be resolvable — webm/opus mic audio is converted to wav)"
