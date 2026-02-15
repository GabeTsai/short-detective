"""
Test vLLM continuous batching with rapid sequential requests.

This simulates your real-world scenario: multiple services/threads calling
transcribe() independently in rapid succession (not pre-batched).

vLLM will automatically batch these if they arrive close together!
"""

import time
import threading
from backend import transcribe, config


def simulate_rapid_requests(delay_between_requests: float = 0.0):
    """
    Simulate multiple clients calling transcribe() in rapid succession.
    
    This mimics your scenario: 8 different services each calling transcribe()
    independently, but happening quickly one after another.
    
    Args:
        delay_between_requests: Seconds between each request (default 0.1s)
    """
    
    url = config.get_transcription_url()
    if not url:
        print("No TRANSCRIPTION_URL set. Deploy server first:")
        return
    
    # Use same file multiple times to simulate similar workload
    # NOTE: All threads reading the same file may cause OS-level I/O contention
    test_file = "test_data/test_audio_2.mp3"
    num_requests = 8

    print("Expected behavior:")
    print("  - If requests arrive during inference window: BATCHED")
    print("  - If requests arrive after previous completes: NOT BATCHED")
    print()
    
    results = []
    request_times = []
    
    def make_request(request_id: int):
        """Single request - mimics one service calling transcribe()."""
        start = time.perf_counter()
        request_times.append(("start", request_id, time.perf_counter()))
        
        print(f"[{time.perf_counter() - global_start:.2f}s] Request {request_id} → calling transcribe()...")
        
        try:
            # Time the transcription call
            t_before_transcribe = time.perf_counter()
            text = transcribe(test_file)
            t_after_transcribe = time.perf_counter()
            elapsed = time.perf_counter() - start
            request_times.append(("end", request_id, time.perf_counter()))
            
            result = {
                "request_id": request_id,
                "success": True,
                "elapsed": elapsed,
                "text_length": len(text)
            }
            results.append(result)
            
            # Warn if request took significantly longer than expected
            if elapsed > 10.0:
                print(f"[{time.perf_counter() - global_start:.2f}s] Request {request_id} ⚠️  SLOW completed in {elapsed:.2f}s (expected ~3-5s)")
            else:
                print(f"[{time.perf_counter() - global_start:.2f}s] Request {request_id} ✓ completed in {elapsed:.2f}s")
            
        except Exception as e:
            elapsed = time.perf_counter() - start
            request_times.append(("end", request_id, time.perf_counter()))
            
            result = {
                "request_id": request_id,
                "success": False,
                "elapsed": elapsed,
                "error": str(e)
            }
            results.append(result)
            
            print(f"[{time.perf_counter() - global_start:.2f}s] Request {request_id} ✗ failed: {e}")
    
    # Start timer
    global_start = time.perf_counter()
    
    # Launch requests in rapid succession (each in its own thread)
    threads = []
    for i in range(num_requests):
        thread = threading.Thread(target=make_request, args=(i+1,))
        thread.start()
        threads.append(thread)
        
        # Small delay between launching threads
        if i < num_requests - 1:  # Don't sleep after last request
            time.sleep(delay_between_requests)
    
    print()
    print(f"All {num_requests} requests launched!")
    print("Waiting for completion...")
    print()
    
    # Wait for all threads to complete
    for thread in threads:
        thread.join()
    
    total_time = time.perf_counter() - global_start
    
    # Analysis
    print()
    print("=" * 80)
    print("RESULTS")
    print("=" * 80)
    
    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]
    
    print(f"Total time: {total_time:.2f}s")
    print(f"Successful: {len(successful)}/{num_requests}")
    print(f"Failed: {len(failed)}/{num_requests}")
    print()
    
    if successful:
        avg_latency = sum(r["elapsed"] for r in successful) / len(successful)
        min_latency = min(r["elapsed"] for r in successful)
        max_latency = max(r["elapsed"] for r in successful)
        
        print(f"Latency stats:")
        print(f"  Average: {avg_latency:.2f}s")
        print(f"  Min: {min_latency:.2f}s")
        print(f"  Max: {max_latency:.2f}s")
        
        # Check for outliers (> 2x average)
        outliers = [r for r in successful if r["elapsed"] > avg_latency * 2]
        if outliers:
            print(f"\n⚠️  OUTLIERS DETECTED: {len(outliers)} request(s) took >2x average:")
            for r in outliers:
                print(f"     Request {r['request_id']}: {r['elapsed']:.2f}s "
                      f"({r['elapsed']/avg_latency:.1f}x slower than average)")
            print()
            print("  Possible causes:")
            print("  - File I/O contention (all threads reading same file)")
            print("  - Python GIL contention during audio processing")
            print("  - OS-level file locking/caching")
            print("  - Network spike on that specific connection")
            print("  - Request got scheduled in separate vLLM batch")
            print()
            print("  To diagnose:")
            print("  1. Check timing logs above (shows where delay occurred)")
            print("  2. Try using different files per request")
            print("  3. Check Modal logs: modal app logs voice-to-text-voxtral --since 5m")
        
        print()
    
    # Analyze timing overlap
    print("Request Timeline:")
    print("-" * 80)
    
    # Sort events by time
    events = sorted(request_times, key=lambda x: x[2])
    
    active_requests = set()
    max_concurrent = 0
    
    for event_type, req_id, timestamp in events:
        if event_type == "start":
            active_requests.add(req_id)
            max_concurrent = max(max_concurrent, len(active_requests))
            print(f"[{timestamp - global_start:.2f}s] Request {req_id} START → {len(active_requests)} active")
        else:
            if req_id in active_requests:
                active_requests.remove(req_id)
            print(f"[{timestamp - global_start:.2f}s] Request {req_id} END   → {len(active_requests)} active")
    
    print()
    print(f"Max concurrent requests: {max_concurrent}")
    print()
    
    # Batching analysis
    if max_concurrent > 1:
        print("BATCHING LIKELY!")
        print(f"   Up to {max_concurrent} requests were active simultaneously.")
        print("   vLLM should have batched these together.")
        print()
        print("Check server logs for confirmation:")
        print(f"   Look for 'Batch size: {max_concurrent}' or 'num_running_reqs={max_concurrent}'")
    else:
        print("NO BATCHING DETECTED")
        print("   Requests completed too quickly or delay was too large.")
        print(f"   Try reducing delay_between_requests (current: {delay_between_requests}s)")
        print()
        print("To enable batching:")
        print("   1. Reduce delay between requests (try 0.05s)")
        print("   2. Ensure requests arrive during ~2-5s inference window")
    
    print()
    return results


def compare_delays():
    """Compare different request delays to find optimal batching."""
    
    delays = [0.05, 0.1, 0.5, 1.0]
    
    print("=" * 80)
    print("COMPARING DIFFERENT REQUEST DELAYS")
    print("=" * 80)
    print()
    print("Testing how delay between requests affects batching...")
    print()
    
    for delay in delays:
        print(f"\n{'=' * 80}")
        print(f"Testing delay: {delay}s")
        print('=' * 80)
        
        input(f"Press Enter to test {delay}s delay... ")
        
        simulate_rapid_requests(delay_between_requests=delay)
        
        print()
        input("Check the logs, then press Enter to continue...")
    
    print()
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print()
    print("Shorter delays → More concurrent requests → Better batching")
    print("Longer delays → Sequential processing → No batching")
    print()
    print("Optimal delay: Fast enough that multiple requests overlap")
    print("               (typically 0.05-0.2s for ~2-5s inference time)")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "compare":
        compare_delays()
    else:
        # Default: simulate rapid requests with no delay
        simulate_rapid_requests(delay_between_requests=0.0)
