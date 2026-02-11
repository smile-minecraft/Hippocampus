import fitz  # PyMuPDF
import sys
import os

def extract_pdf(pdf_path, output_dir="docs/imported"):
    doc = fitz.open(pdf_path)
    base_name = os.path.splitext(os.path.basename(pdf_path))[0]
    
    # 建立輸出目錄
    target_dir = os.path.join(output_dir, base_name)
    assets_dir = os.path.join("docs/public/assets", base_name)
    os.makedirs(target_dir, exist_ok=True)
    os.makedirs(assets_dir, exist_ok=True)
    
    md_content = f"# {base_name}\n\n"
    
    print(f"Processing {pdf_path}...")

    for page_num, page in enumerate(doc):
        # 1. 提取文字
        text = page.get_text()
        md_content += f"## Page {page_num + 1}\n\n{text}\n\n"
        
        # 2. 提取圖片
        image_list = page.get_images(full=True)
        for img_index, img in enumerate(image_list):
            xref = img[0]
            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]
            ext = base_image["ext"]
            
            image_filename = f"p{page_num+1}_{img_index+1}.{ext}"
            image_path = os.path.join(assets_dir, image_filename)
            
            with open(image_path, "wb") as f:
                f.write(image_bytes)
            
            # 在 Markdown 中插入圖片參照
            md_content += f"![Image](/assets/{base_name}/{image_filename})\n\n"

    # 3. 寫入 Markdown 檔案
    output_md_path = os.path.join(target_dir, "index.md")
    with open(output_md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    
    print(f"Done! Markdown saved to {output_md_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pdf_extract.py <path_to_pdf>")
    else:
        extract_pdf(sys.argv[1])
