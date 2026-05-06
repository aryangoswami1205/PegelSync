# SerHydroSys: Serverless Hydrological Flood Risk Alert System 🌊

**SerHydroSys** is a zero-dependency, cloud-native microservice and dashboard designed to monitor real-time river gauge data across Germany (Rhine, Danube, Elbe) and generate flood risk alerts.

Built to replace expensive 24/7 server-based monitoring, this project leverages AWS Serverless technologies to achieve a highly scalable, fault-tolerant system that costs $0.00/month to run under the AWS Free Tier.

## 🌟 Key Features

*   **Zero-Dependency Backend**: The core AWS Lambda function is built using purely Python standard libraries (`urllib`, `json`). This eliminates the need for bulky ZIP deployment packages and reduces Lambda cold-start times.
*   **Real-Time Data Ingestion**: Fetches live telemetry concurrently from the German **PEGELONLINE REST API (v2)**.
*   **Fault-Tolerant Execution**: Gracefully handles API rate limits, HTTP errors, and unencoded special characters (e.g., German umlauts) without failing the entire monitoring batch.
*   **Decoupled Frontend**: Uses Amazon S3 to store generated alert payloads and a `latest_status.json` snapshot, which powers a responsive, CORS-enabled, vanilla JavaScript WebGIS dashboard.
*   **Automated Scheduling**: Triggered hourly via AWS EventBridge.

## 🏗️ Architecture

1.  **AWS EventBridge** triggers the Lambda function every hour.
2.  **AWS Lambda** executes the Python script, iterating over a configurable array of monitoring stations.
3.  The Lambda function fetches live data from the **PEGELONLINE REST API**.
4.  If a station's water level exceeds its defined threshold, an alert payload is appended to a batch.
5.  **Amazon S3** stores the alert batches and a constantly updated `latest_status.json`.
6.  The **Frontend Dashboard** (Static HTML/CSS/JS hosted via GitHub Pages or S3 Static Hosting) fetches `latest_status.json` and renders live gauges and status badges.

## 📂 Repository Structure

*   `lambda_function.py`: The core AWS Lambda backend script.
*   `frontend-dashboard/`: Contains the static frontend (`index.html`, `app.js`, `styles.css`).
*   `Dockerfile`: A container configuration for safely testing the Lambda function locally in an isolated Linux environment.
*   `requirements.txt`: Contains `boto3` for local testing only (pre-installed in the AWS Lambda runtime).

## 🚀 Quick Start & Deployment

This project is designed to be deployed manually via the AWS Management Console to aid in learning cloud infrastructure.

1.  Test the logic locally using Docker:
    ```bash
    docker build -t serhydrosys .
    docker run --rm serhydrosys
    ```
2.  Deploy the frontend by serving the `frontend-dashboard` directory locally or enabling GitHub Pages.

## 🛠️ Tech Stack

*   **Cloud Infrastructure**: AWS Lambda, Amazon S3, AWS EventBridge, AWS IAM
*   **Backend**: Python 3.9+ (Standard Library)
*   **Frontend**: HTML5, CSS3, Vanilla JavaScript
*   **Containerization**: Docker
*   **Data Source**: PEGELONLINE REST API (v2)

## 👤 Author

Built by **Aryan Goswami**
