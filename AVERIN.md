**AVERIN.md**
For Claude.

**Problem Statement**

Value-based care in America is fragmented and complex. Many health systems do not have the tools and financial resources to implement reliable value-based care programs, and leave billions of dollars on the table. Without a coordinated and agile response, patients suffer with poor outcomes, and providers suffer the administrative burden. Averin plans to change the future of value-based care by reducing provider burden, architecting the first AI value-based care program, and improving patient outcomes.

**Product Overview**  
Averin is an AI-supported provider contract parser that allows hospital systems to better negotiate contracts given their patient populations. Averin should parse the contracts extracting out the metrics and will then provide a scoring system (see example below \- don’t use that for design though) of how the system’s metrics (extracted from EHR map to that of the contract). This will help the medical directors see if the contract metrics are favorable given their population for that provider and thus use that information for negotiation.


**Components**

* **Module 1: Contract Intelligence Parser**  
  * **Goal**: Upload one or several VBC contract PDFs → AI extracts structured metric data automatically.  
  * **Build Instructions:** A simple upload interface where the user drops in a contract PDF. The backend sends the PDF content to an LLM with a prompt that instructs it to extract every metric into a structured JSON format — metric name, target value, weight, calculation method, payer name. Display the extracted metrics in a clean table so the user can review what the AI pulled out. For the demo, we prepare 2-3 simulated contract PDFs with realistic metrics so you can show it working across different payers.  
* **Module 2: Performance Tracking Dashboard**  
  * **Goal**: Map extracted metrics against patient data → show real-time compliance status across all contracts.  
  * **What to build**: Generate a simulated patient dataset (CSV, a few thousand rows — patient ID, diagnosis codes, A1C values, blood pressure readings, screening dates, last visit date). Build a dashboard that takes the extracted metrics from Module 1 and calculates current performance against each target. Each metric row shows: metric name, target, current performance, gap, weight, and a color indicator (green / yellow / red). Add a top-level summary: estimated overall Star Rating, and a financial impact line — "You're currently at 3.8 stars. Closing these 3 red gaps could move you to 4.2 stars, which represents approximately $X in additional shared savings." If possible, allow switching between payers so the user can see performance across different contracts side by side.

**Technology**

* **LLM:** For this demo we want to use a free LLM. We should use something like Gemini 3 Flash that allows free use. This repo outlines free LLM resources: https://github.com/cheahjs/free-llm-api-resources?tab=readme-ov-file\#google-ai-studio 

**Design**  
The target user is medical executives (NOT PHYSICIANS) so the UI should be VERY simple. There should be a simple upload interface that allows dragging and dropping multiple contracts for upload. Also, whenever contracts are parsed and the metrics are laid out, it should be very easy for users to find the part of the contract that Averin used to derive that metric and should explain where in the EHR the metrics were forged from.

**Resources**  
Please see the contracts/ folder for mock contracts from UnitedHealth, Aetna, etc.
