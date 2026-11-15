from moviepy.editor import *
import numpy as np

# Video settings
WIDTH, HEIGHT = 1280, 720
DURATION = 10  # seconds
FPS = 30

# Color palette
BG_COLOR = (13, 17, 23)          # #0d1117
ACCENT_COLOR = (88, 166, 255)    # #58a6ff
ACCENT2_COLOR = (248, 81, 73)    # #f85149
TEXT_COLOR = (230, 237, 243)     # #e6edf3
MUTED_COLOR = (139, 148, 158)    # #8b949e


def make_frame(t):
    """Generate a single frame at time t (seconds)"""
    img = np.full((HEIGHT, WIDTH, 3), BG_COLOR, dtype=np.uint8)
    
    # Animated background circles
    for i in range(5):
        phase = t * 0.5 + i * 1.2
        x = int(WIDTH * 0.5 + np.sin(phase) * 200 * np.sin(t * 0.3 + i))
        y = int(HEIGHT * 0.5 + np.cos(phase * 0.7) * 150 * np.cos(t * 0.2 + i))
        radius = int(50 + 30 * np.sin(t * 2 + i))
        color = ACCENT_COLOR if i % 2 == 0 else ACCENT2_COLOR
        alpha = 0.15 + 0.1 * np.sin(t * 3 + i)
        
        # Draw circle with alpha blending (simplified)
        y_grid, x_grid = np.ogrid[:HEIGHT, :WIDTH]
        mask = (x_grid - x)**2 + (y_grid - y)**2 <= radius**2
        img[mask] = (img[mask] * (1 - alpha) + np.array(color) * alpha).astype(np.uint8)
    
    # Animated title text (simulated with rectangles since no font rendering)
    # Pulse effect
    pulse = 1 + 0.1 * np.sin(t * 4)
    
    # Progress bar at bottom
    progress = (t / DURATION)
    bar_width = int(WIDTH * 0.8 * progress)
    bar_y = HEIGHT - 60
    img[bar_y:bar_y+4, int(WIDTH*0.1):int(WIDTH*0.1)+bar_width] = ACCENT_COLOR
    
    # Scanning line effect
    scan_y = int((t * 50) % HEIGHT)
    img[scan_y:scan_y+2, :] = [min(c + 40, 255) for c in BG_COLOR]
    
    return img


def create_video():
    print(f"Generating {DURATION}s video at {FPS}fps ({WIDTH}x{HEIGHT})...")
    
    # Create video clip from frame function
    clip = VideoClip(make_frame, duration=DURATION)
    clip = clip.set_fps(FPS)
    
    # Add audio (simple tone)
    def make_audio(t):
        freq = 220 + 110 * np.sin(t * 2)  # A3 to A4 sweep
        return 0.1 * np.sin(2 * np.pi * freq * t)
    
    audio = AudioClip(make_audio, duration=DURATION, fps=44100)
    clip = clip.set_audio(audio)
    
    # Write video file
    output_path = "generated_video.mp4"
    clip.write_videofile(output_path, fps=FPS, codec='libx264', audio_codec='aac',
                         preset='medium', threads=4, logger='bar')
    print(f"\nDone! Video saved to {output_path}")


if __name__ == "__main__":
    create_video()