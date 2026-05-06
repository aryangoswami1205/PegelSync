# ──────────────────────────────────────────────────────────
# SerHydroSys — Dockerfile for Local Lambda Testing
# ──────────────────────────────────────────────────────────
# This image mimics a minimal AWS Lambda Python environment
# so we can test our flood-alert script in isolation before
# deploying it to the cloud.
# ──────────────────────────────────────────────────────────

# Start from a lightweight official Python image.
# "slim" strips out compilers, man-pages, and other things
# we don't need — keeping the image small and fast to build.
FROM python:3.9-slim

# Set a working directory inside the container.
# All subsequent commands (COPY, RUN, CMD) will execute
# relative to this path.
WORKDIR /app

# Copy only the requirements file first.
# Docker caches each layer — by copying requirements.txt
# BEFORE the source code, we avoid re-installing packages
# every time we change a line of Python. This is a common
# Docker best practice called "layer caching".
COPY requirements.txt .

# Install the Python dependencies listed in requirements.txt.
# --no-cache-dir : don't store pip's download cache (saves space)
# --upgrade pip  : ensure we have the latest pip version
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Now copy the Lambda function source code into the container.
COPY lambda_function.py .

# Tell Docker what command to run when the container starts.
# This executes our script exactly the way Lambda would
# (via the `if __name__ == "__main__"` block at the bottom).
CMD ["python", "lambda_function.py"]
